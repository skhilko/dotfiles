/**
 * llama-switch Extension
 *
 * Integrates Pi with a llama.cpp model switcher (llama-switch-manager).
 *
 * Features:
 *  - Auto-switches the llama.cpp server when you change Pi's model (model_select hook)
 *  - /llama-switch command → interactive overlay with status, model list, config sync
 *  - Ctrl+Shift+L → quick-open the model selector overlay
 *  - llama_switch tool → agent-callable model switching
 *  - Footer status indicator showing current server model + readiness
 *  - Sync/upsert full model metadata from admin API into Pi's models.json
 *
 * Config (pick one, in priority order):
 *  1. LLAMA_SWITCH_HOST env var (host:port or just host)
 *  2. ~/.pi/agent/llama-switch.json
 *  3. Default: localhost:8090
 *
 * Config file format:
 *   { "host": "<llama-switch-host>", "port": 8090, "provider": "llama-cpp" }
 */

import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { DynamicBorder, getAgentDir } from "@earendil-works/pi-coding-agent";
import { Container, Key, type SelectItem, SelectList, Text, truncateToWidth } from "@earendil-works/pi-tui";
import { Type } from "typebox";
import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { join } from "node:path";

// ── Types ────────────────────────────────────────────────────────────────────

interface PiModelEntry {
    id: string;
    name: string;
    reasoning?: boolean;
    input?: string[];
    contextWindow?: number;
    maxTokens?: number;
    cost?: Record<string, number>;
    thinkingLevelMap?: Record<string, string | null>;
    compat?: Record<string, unknown>;
}

interface AdminModel {
    name: string;        // admin alias (used in /switch/<name>)
    display: string;     // display name
    pi_id: string;       // Pi model id
    pi_name: string;     // Pi model name
    context_window: number;
    vision: boolean;
    thinking: boolean;
    endpoint_port?: number;
    pi_model?: PiModelEntry;
}

interface AdminStatus {
    model: string | null;
    pid: number | null;
    uptime: number | null;
    ready: boolean;
    host: string;
    port: number;
}

interface SwitchResult {
    ok: boolean;
    status: string;
    [key: string]: unknown;
}

interface LlamaSwitchConfig {
    host: string;
    port: number;
    provider: string;
}

// ── Config ───────────────────────────────────────────────────────────────────

const DEFAULT_CONFIG: LlamaSwitchConfig = {
    host: "localhost",
    port: 8090,
    provider: "llama-cpp",
};

function loadConfig(): LlamaSwitchConfig {
    const envHost = process.env["LLAMA_SWITCH_HOST"];
    if (envHost) {
        const parts = envHost.split(":");
        return {
            host: parts[0]!,
            port: parts[1] ? parseInt(parts[1], 10) : DEFAULT_CONFIG.port,
            provider: DEFAULT_CONFIG.provider,
        };
    }

    const configPath = join(getAgentDir(), "llama-switch.json");
    if (existsSync(configPath)) {
        try {
            const data = JSON.parse(readFileSync(configPath, "utf-8"));
            return {
                host: data.host ?? DEFAULT_CONFIG.host,
                port: data.port ?? DEFAULT_CONFIG.port,
                provider: data.provider ?? DEFAULT_CONFIG.provider,
            };
        } catch {
            console.error("[llama-switch] Failed to parse config file");
        }
    }

    return DEFAULT_CONFIG;
}

// ── HTTP Client ──────────────────────────────────────────────────────────────

function adminUrl(config: LlamaSwitchConfig, path: string): string {
    return `http://${config.host}:${config.port}${path}`;
}

async function fetchAdmin<T>(config: LlamaSwitchConfig, path: string): Promise<T | null> {
    try {
        const resp = await fetch(adminUrl(config, path), {
            signal: AbortSignal.timeout(5000),
        });
        if (!resp.ok) return null;
        return (await resp.json()) as T;
    } catch {
        return null;
    }
}

async function switchModel(config: LlamaSwitchConfig, modelName: string): Promise<SwitchResult> {
    try {
        const resp = await fetch(adminUrl(config, `/switch/${modelName}`), {
            method: "POST",
            signal: AbortSignal.timeout(30000),
        });
        const body = await resp.text();
        return {
            ok: resp.ok,
            status: resp.status === 200 ? "switching" : "error",
            message: body,
        };
    } catch (err) {
        return { ok: false, status: "error", message: String(err) };
    }
}

async function stopServer(config: LlamaSwitchConfig): Promise<SwitchResult> {
    try {
        const resp = await fetch(adminUrl(config, "/stop"), {
            method: "POST",
            signal: AbortSignal.timeout(10000),
        });
        return {
            ok: resp.ok,
            status: resp.ok ? "stopped" : "error",
        };
    } catch (err) {
        return { ok: false, status: "error", message: String(err) };
    }
}

async function reloadServerManifest(config: LlamaSwitchConfig): Promise<SwitchResult> {
    try {
        const resp = await fetch(adminUrl(config, "/reload-models"), {
            method: "POST",
            signal: AbortSignal.timeout(10000),
        });
        const body = await resp.text();
        return {
            ok: resp.ok,
            status: resp.ok ? "reloaded" : "error",
            message: body,
        };
    } catch (err) {
        // Older managers do not have /reload-models. Refresh/sync can still use
        // whatever the running admin API currently exposes.
        return { ok: false, status: "error", message: String(err) };
    }
}

async function pollUntilReady(
    config: LlamaSwitchConfig,
    expectedModel: string,
    maxAttempts: number = 60,
): Promise<boolean> {
    for (let i = 0; i < maxAttempts; i++) {
        const status = await fetchAdmin<AdminStatus>(config, "/status");
        if (status?.ready && status.model === expectedModel) {
            return true;
        }
        await new Promise((r) => setTimeout(r, 1000));
    }
    return false;
}

// ── Models JSON helpers ──────────────────────────────────────────────────────

function loadModelsJson(): Record<string, unknown> {
    const path = join(getAgentDir(), "models.json");
    if (!existsSync(path)) return {};
    return JSON.parse(readFileSync(path, "utf-8"));
}

function saveModelsJson(data: Record<string, unknown>): void {
    const path = join(getAgentDir(), "models.json");
    writeFileSync(path, JSON.stringify(data, null, 2) + "\n");
}

/**
 * Upsert full model metadata from the admin API into Pi's models.json and settings.json.
 *
 * Newer llama-switch managers include `pi_model`, which is the exact Pi model
 * entry generated from the server manifest. That preserves reasoning toggles,
 * thinking level maps, compatibility flags, multimodal input, and token limits
 * on remote Pi clients. Older managers fall back to the historical minimal shape.
 */
async function syncPiModels(
    config: LlamaSwitchConfig,
    ctx: ExtensionContext,
): Promise<{ added: string[]; updated: string[]; unchanged: string[]; removedProviders: string[] }> {
    await reloadServerManifest(config);
    const modelsData = await fetchAdmin<{ models: AdminModel[] }>(config, "/models");
    if (!modelsData?.models?.length) {
        ctx.ui.notify("No models available from admin API", "warning");
        return { added: [], updated: [], unchanged: [], removedProviders: [] };
    }

    const modelsJson = loadModelsJson();
    modelsJson.providers = modelsJson.providers ?? {};

    const endpointPort = modelsData.models.find((m) => m.endpoint_port)?.endpoint_port ?? 8080;
    const existingProvider = modelsJson.providers[config.provider] as Record<string, unknown> | undefined;
    const existingModels = (existingProvider?.models as Array<PiModelEntry> | undefined) ?? [];
    const existingById = new Map(existingModels.map((m) => [m.id, m]));

    const added: string[] = [];
    const updated: string[] = [];
    const unchanged: string[] = [];
    const removedProviders: string[] = [];

    const syncedModels = modelsData.models.map((model) => {
        const piModel: PiModelEntry = model.pi_model ?? {
            id: model.pi_id,
            name: model.pi_name,
            reasoning: model.thinking,
            input: model.vision ? ["text", "image"] : ["text"],
            contextWindow: model.context_window,
            maxTokens: 32768,
            cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
        };

        const previous = existingById.get(piModel.id);
        if (!previous) {
            added.push(piModel.id);
        } else if (JSON.stringify(previous) !== JSON.stringify(piModel)) {
            updated.push(piModel.id);
        } else {
            unchanged.push(piModel.id);
        }
        return piModel;
    });

    modelsJson.providers[config.provider] = {
        ...(existingProvider ?? {}),
        baseUrl: `http://${config.host}:${endpointPort}/v1`,
        api: "openai-completions",
        apiKey: "none",
        compat: {
            supportsDeveloperRole: false,
            supportsReasoningEffort: false,
            ...((existingProvider?.compat as Record<string, unknown> | undefined) ?? {}),
        },
        models: syncedModels,
    };

    for (const key of Object.keys(modelsJson.providers as Record<string, unknown>)) {
        if (key.startsWith(`${config.provider}-`) && key !== config.provider) {
            delete (modelsJson.providers as Record<string, unknown>)[key];
            removedProviders.push(key);
        }
    }

    saveModelsJson(modelsJson);

    // Also add to enabledModels in settings.json.
    const settingsPath = join(getAgentDir(), "settings.json");
    if (existsSync(settingsPath)) {
        const settings = JSON.parse(readFileSync(settingsPath, "utf-8"));
        let enabledModels = settings.enabledModels as string[] | undefined;
        if (enabledModels) {
            if (removedProviders.length > 0) {
                enabledModels = enabledModels.filter(
                    (entry) => !removedProviders.some((provider) => entry.startsWith(`${provider}/`)),
                );
            }
            for (const model of syncedModels) {
                const fq = `${config.provider}/${model.id}`;
                if (!enabledModels.includes(fq)) {
                    enabledModels.push(fq);
                }
            }
            settings.enabledModels = enabledModels;
            writeFileSync(settingsPath, JSON.stringify(settings, null, 2) + "\n");
        }
    }

    return { added, updated, unchanged, removedProviders };
}

async function offerReload(ctx: ExtensionContext): Promise<void> {
    const reload = (ctx as unknown as { reload?: () => Promise<void> }).reload;
    if (typeof reload !== "function") {
        ctx.ui.notify("Run /reload to apply the synced model config.", "info");
        return;
    }

    const ok = await ctx.ui.confirm("Reload Pi", "Reload Pi now to apply synced model config?");
    if (ok) {
        await reload.call(ctx);
    } else {
        ctx.ui.notify("Run /reload later to apply the synced model config.", "info");
    }
}


// ── Extension State ──────────────────────────────────────────────────────────

interface ExtensionState {
    config: LlamaSwitchConfig;
    models: AdminModel[];
    status: AdminStatus | null;
    modelMap: Map<string, string>; // pi_id -> admin name
    switching: boolean;
}

// ── Extension ────────────────────────────────────────────────────────────────

export default function (pi: ExtensionAPI) {
    const state: ExtensionState = {
        config: loadConfig(),
        models: [],
        status: null,
        modelMap: new Map(),
        switching: false,
    };

    /**
     * Build the llama status indicator string and push it into the default footer
     * via ctx.ui.setStatus(). This preserves the default footer UI (PWD, branch,
     * token stats, model name) while appending our own status indicator inline.
     */
    function updateStatus(ctx: ExtensionContext): void {
        const theme = ctx.ui.theme;
        if (state.switching) {
            ctx.ui.setStatus("llama-switch", theme.fg("warning", " ⟳"));
        } else if (state.status?.ready && state.status.model) {
            ctx.ui.setStatus("llama-switch", theme.fg("success", ` ● ${state.status.model}`));
        } else if (state.status?.model) {
            ctx.ui.setStatus("llama-switch", theme.fg("warning", ` ⟳ ${state.status.model}`));
        } else {
            ctx.ui.setStatus("llama-switch", theme.fg("dim", " ◌"));
        }
    }

    async function refreshState(): Promise<void> {
        const [modelsData, statusData] = await Promise.all([
            fetchAdmin<{ models: AdminModel[] }>(state.config, "/models"),
            fetchAdmin<AdminStatus>(state.config, "/status"),
        ]);

        if (modelsData?.models) {
            state.models = modelsData.models;
            state.modelMap = new Map(
                modelsData.models.map((m) => [m.pi_id, m.name]),
            );
        }
        if (statusData) {
            state.status = statusData;
        }
    }

    // ── model_select hook ────────────────────────────────────────────────────
    // Auto-switch the server when Pi model changes to a llama-cpp model.

    pi.on("model_select", async (event, ctx) => {
        if (event.model.provider !== state.config.provider) return;
        if (state.switching) return;

        const adminName = state.modelMap.get(event.model.id);
        if (!adminName) {
            ctx.ui.notify(
                `[llama-switch] Model "${event.model.id}" not on server. Run /llama-switch sync, then /reload.`,
                "warning",
            );
            return;
        }

        if (state.status?.model === adminName && state.status.ready) {
            return;
        }

        state.switching = true;
        updateStatus(ctx);

        const result = await switchModel(state.config, adminName);

        if (result.ok) {
            const ready = await pollUntilReady(state.config, adminName, 30);
            if (ready) {
                state.status = await fetchAdmin<AdminStatus>(state.config, "/status") ?? state.status;
            } else {
                ctx.ui.notify(`Switched to ${adminName} (server still loading)`, "info");
            }
        } else {
            ctx.ui.notify(`Failed to switch to ${adminName}: ${result.message ?? "unknown"}`, "error");
        }

        state.switching = false;
        updateStatus(ctx);
    });

    // ── /llama-switch command ────────────────────────────────────────────────

    pi.registerCommand("llama-switch", {
        description: "Switch llama.cpp model via admin API",
        getArgumentCompletions: (prefix: string): Array<{ value: string; label: string }> | null => {
            if (prefix === "") return null;
            const commands = [
                { value: "sync", label: "sync Pi model config from admin API" },
                { value: "provision", label: "alias for sync" },
            ];
            const items = [
                ...commands,
                ...state.models.map((m) => ({ value: m.name, label: m.display })),
            ];
            const filtered = items.filter((i) => i.value.startsWith(prefix));
            return filtered.length > 0 ? filtered : null;
        },
        handler: async (args, ctx) => {
            if (args?.trim()) {
                const target = args.trim();
                if (target === "sync" || target === "provision") {
                    const result = await syncPiModels(state.config, ctx);
                    ctx.ui.notify(
                        `Synced Pi config: ${result.added.length} added, ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.removedProviders.length} old providers removed`,
                        "success",
                    );
                    await offerReload(ctx);
                    return;
                }

                const model = state.models.find(
                    (m) => m.name === target || m.pi_id === target,
                );
                if (!model) {
                    ctx.ui.notify(`Unknown model "${target}". Available: ${state.models.map((m) => m.name).join(", ")}`, "error");
                    return;
                }
                await doSwitch(model, ctx);
                return;
            }

            await showSwitchOverlay(ctx);
        },
    });

    // ── Ctrl+Shift+L shortcut ────────────────────────────────────────────────

    pi.registerShortcut(Key.ctrlShift("l"), {
        description: "Open llama-switch model selector",
        handler: async (ctx) => {
            await showSwitchOverlay(ctx);
        },
    });

    // ── Switch overlay ───────────────────────────────────────────────────────

    async function showSwitchOverlay(ctx: ExtensionContext): Promise<void> {
        await refreshState();
        updateStatus(ctx);

        if (state.models.length === 0) {
            ctx.ui.notify("No models found from admin API. Is llama-switch-manager running?", "warning");
            return;
        }

        const selected = await renderOverlay(ctx);
        if (!selected) return;

        // Handle actions
        if (selected === "__refresh") {
            const reload = await reloadServerManifest(state.config);
            await refreshState();
            updateStatus(ctx);
            ctx.ui.notify(
                reload.ok ? `Models/status refreshed (${state.models.length} models)` : `Status refreshed (${state.models.length} models); server manifest reload unavailable`,
                reload.ok ? "success" : "info",
            );
            return;
        }

        if (selected === "__stop") {
            const ok = await ctx.ui.confirm("Stop server", "Stop the llama.cpp server?");
            if (!ok) return;

            state.status = null;
            updateStatus(ctx);
            const res = await stopServer(state.config);
            if (res.ok) {
                state.status = { model: null, pid: null, uptime: null, ready: false, host: state.config.host, port: state.config.port };
                updateStatus(ctx);
                ctx.ui.notify("Server stopped", "info");
            } else {
                ctx.ui.notify(`Failed to stop server: ${res.message ?? "unknown"}`, "error");
            }
            return;
        }

        if (selected === "__provision") {
            const ok = await ctx.ui.confirm("Sync Pi model config", "Upsert full admin API model metadata into Pi's models.json?");
            if (!ok) return;

            const result = await syncPiModels(state.config, ctx);
            ctx.ui.notify(
                `Synced Pi config: ${result.added.length} added, ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.removedProviders.length} old providers removed`,
                "success",
            );
            await offerReload(ctx);
            return;
        }

        if (selected === "__config") {
            ctx.ui.notify(
                `Config: ${state.config.host}:${state.config.port} | provider: ${state.config.provider}`,
                "info",
            );
            return;
        }

        // Model selection
        if (selected !== "---") {
            const model = state.models.find((m) => m.name === selected);
            if (model) {
                await doSwitch(model, ctx);
            }
        }
    }

    async function renderOverlay(ctx: ExtensionContext): Promise<string | null> {
        return ctx.ui.custom<string | null>(
            (tui, theme, _kb, done) => {
                const currentName = state.status?.model ?? null;

                const items: SelectItem[] = state.models.map((m) => {
                    const isActive = m.name === currentName;
                    const prefix = isActive ? "● " : "  ";
                    const features: string[] = [];
                    if (m.thinking) features.push("thinking");
                    if (m.vision) features.push("vision");
                    const featStr = features.length > 0 ? ` (${features.join(", ")})` : "";
                    return {
                        value: m.name,
                        label: `${prefix}${m.display}${featStr}`,
                        description: `${m.pi_id} | ctx: ${(m.context_window / 1024).toFixed(0)}K`,
                    };
                });

                const actionItems: SelectItem[] = [
                    { value: "---", label: "--- actions ---", description: "" },
                    { value: "__refresh", label: "  ⟳ Refresh models/status", description: "Reload server manifest, then re-fetch admin API" },
                    { value: "__stop", label: "  ■ Stop server", description: "Shutdown llama.cpp server" },
                    { value: "__provision", label: "  ⊕ Sync Pi model config", description: "Upsert full models.json metadata" },
                    {
                        value: "__config",
                        label: `  ⚙ ${state.config.host}:${state.config.port}`,
                        description: `provider: ${state.config.provider}`,
                    },
                ];

                const selectItems = [...items, ...actionItems];
                const visible = Math.min(selectItems.length, 14);

                const container = new Container();

                container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

                const statusLine = state.status
                    ? state.status.ready
                        ? `Server: ${state.status.host}:${state.status.port} | Model: ${state.status.model ?? "none"} | Uptime: ${formatUptime(state.status.uptime ?? 0)}`
                        : "Server: loading..."
                    : "Server: unreachable";

                container.addChild(new Text(theme.fg("accent", theme.bold("llama-switch"))));
                container.addChild(new Text(theme.fg("dim", truncateToWidth(statusLine, 200)), 1, 0));

                const selectList = new SelectList(selectItems, visible, {
                    selectedPrefix: (t: string) => theme.fg("accent", t),
                    selectedText: (t: string) => theme.fg("accent", t),
                    description: (t: string) => theme.fg("muted", t),
                    scrollInfo: (t: string) => theme.fg("dim", t),
                    noMatch: (t: string) => theme.fg("warning", t),
                });

                selectList.onSelect = (item) => done(item.value);
                selectList.onCancel = () => done(null);

                container.addChild(selectList);
                container.addChild(new Text(theme.fg("dim", "↑↓ navigate • enter select • esc cancel")));
                container.addChild(new DynamicBorder((s: string) => theme.fg("accent", s)));

                return {
                    render(width: number) {
                        return container.render(width);
                    },
                    invalidate() {
                        container.invalidate();
                    },
                    handleInput(data: string) {
                        selectList.handleInput(data);
                        tui.requestRender();
                    },
                };
            },
            { overlay: true },
        );
    }

    // ── Switch helper ────────────────────────────────────────────────────────

    async function doSwitch(model: AdminModel, ctx: ExtensionContext): Promise<void> {
        if (state.switching) {
            ctx.ui.notify("Already switching a model", "warning");
            return;
        }

        if (state.status?.model === model.name && state.status?.ready) {
            ctx.ui.notify(`Already running: ${model.display}`, "info");
            return;
        }

        state.switching = true;
        updateStatus(ctx);

        const result = await switchModel(state.config, model.name);

        if (result.ok) {
            const ready = await pollUntilReady(state.config, model.name, 30);
            if (ready) {
                state.status = await fetchAdmin<AdminStatus>(state.config, "/status") ?? state.status;
                ctx.ui.notify(`Switched to ${model.display}`, "success");

                const piModel = ctx.modelRegistry.find(state.config.provider, model.pi_id);
                if (piModel) {
                    await pi.setModel(piModel);
                }
            } else {
                ctx.ui.notify(`Switched to ${model.name} (server still loading)`, "info");
            }
        } else {
            ctx.ui.notify(`Failed to switch to ${model.name}: ${result.message ?? "unknown"}`, "error");
        }

        state.switching = false;
        updateStatus(ctx);
    }

    // ── llama_switch tool (agent-callable) ────────────────────────────────────

    pi.registerTool({
        name: "llama_switch",
        label: "Llama Switch",
        description: "Switch the llama.cpp server to a different model or check server status",
        promptSnippet: "llama_switch — switch llama.cpp model or check status via admin API",
        promptGuidelines: [
            "Use llama_switch when the user asks to switch local models, check server status, or lists available models.",
        ],
        parameters: Type.Object({
            action: Type.Enum({
                switch: "switch",
                status: "status",
                list: "list",
                stop: "stop",
                sync: "sync",
            } as const),
            model: Type.Optional(
                Type.String({
                    description: "Model name or pi_id to switch to (required for 'switch' action)",
                }),
            ),
        }),
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
            await refreshState();

            if (params.action === "list") {
                const lines = state.models.map((m) => {
                    const active = state.status?.model === m.name ? " ● active" : "";
                    const features: string[] = [];
                    if (m.thinking) features.push("thinking");
                    if (m.vision) features.push("vision");
                    const feat = features.length > 0 ? ` [${features.join(",")}]` : "";
                    return `  ${m.name} — ${m.display}${feat}${active}`;
                });

                const status = state.status
                    ? `\n\nServer status: ${state.status.ready ? "ready" : "loading"} | model: ${state.status.model ?? "none"} | uptime: ${formatUptime(state.status.uptime ?? 0)}`
                    : "\n\nServer: unreachable";

                return {
                    content: [{ type: "text", text: `Available models (${state.models.length}):${status}\n${lines.join("\n")}` }],
                    details: { models: state.models },
                };
            }

            if (params.action === "status") {
                if (!state.status) {
                    return {
                        content: [{ type: "text", text: "Server unreachable" }],
                        details: { reachable: false },
                    };
                }
                return {
                    content: [{ type: "text", text: `Model: ${state.status.model ?? "none"} | Ready: ${state.status.ready} | Uptime: ${formatUptime(state.status.uptime ?? 0)}` }],
                    details: { status: state.status },
                };
            }

            if (params.action === "stop") {
                const res = await stopServer(state.config);
                if (res.ok) {
                    return {
                        content: [{ type: "text", text: "Server stopped" }],
                        details: { stopped: true },
                    };
                }
                return {
                    content: [{ type: "text", text: `Failed to stop: ${res.message ?? "unknown"}` }],
                    details: { stopped: false },
                    isError: true,
                };
            }

            if (params.action === "sync") {
                const result = await syncPiModels(state.config, ctx);
                return {
                    content: [{
                        type: "text",
                        text: `Synced Pi config: ${result.added.length} added, ${result.updated.length} updated, ${result.unchanged.length} unchanged, ${result.removedProviders.length} old providers removed. Run /reload to apply.`,
                    }],
                    details: result,
                };
            }

            if (params.action === "switch") {
                if (!params.model) {
                    return {
                        content: [{ type: "text", text: "Error: model name required for switch action" }],
                        isError: true,
                    };
                }

                const model = state.models.find(
                    (m) => m.name === params.model || m.pi_id === params.model,
                );
                if (!model) {
                    return {
                        content: [{ type: "text", text: `Unknown model "${params.model}". Run action=list to see available models.` }],
                        isError: true,
                    };
                }

                await doSwitch(model, ctx);

                return {
                    content: [{ type: "text", text: `Switched to ${model.display} (${model.name})` }],
                    details: { model: model.name, pi_id: model.pi_id },
                };
            }

            return {
                content: [{ type: "text", text: `Unknown action: ${params.action}` }],
                isError: true,
            };
        },
    });

    // ── Session lifecycle ────────────────────────────────────────────────────

    let statusTimer: ReturnType<typeof setInterval> | null = null;

    pi.on("session_start", async (_event, ctx) => {
        await refreshState();

        if (state.models.length === 0) {
            ctx.ui.notify(
                `[llama-switch] No models found at ${state.config.host}:${state.config.port}. Set LLAMA_SWITCH_HOST or create ~/.pi/agent/llama-switch.json`,
                "warning",
            );
        }

        // Use ctx.ui.setStatus() to inject llama status into the default footer.
        // This preserves the default footer (PWD, branch, token stats, model name)
        // while appending our indicator inline with the extension statuses area.
        updateStatus(ctx);

        // Periodic status refresh every 10s
        statusTimer = setInterval(async () => {
            await refreshState();
            updateStatus(ctx);
        }, 10_000);
    });

    pi.on("session_shutdown", async () => {
        state.switching = false;
        if (statusTimer) {
            clearInterval(statusTimer);
            statusTimer = null;
        }
    });
}

// ── Helpers ──────────────────────────────────────────────────────────────────

function formatUptime(seconds: number): string {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
    return `${Math.floor(seconds / 86400)}d ${Math.floor((seconds % 86400) / 3600)}h`;
}
