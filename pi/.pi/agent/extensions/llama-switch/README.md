# llama-switch Pi Extension

Pi extension that integrates with [llama-switch-manager](https://github.com/…) — a single-port llama.cpp model switcher with a LAN-accessible admin API. Only one model can run at a time on llama.cpp, so switching requires a server reload. This extension bridges Pi's model selection with the switcher's admin API so you don't have to manage it manually.

## What It Does

| Feature | Description |
|---------|-------------|
| **Auto-switch** | When you change Pi's model via `/model` or `Ctrl+P`, the extension switches the llama.cpp server automatically |
| **Interactive overlay** | `/llama-switch` opens a model selector with status, features, and actions |
| **Keyboard shortcut** | `Ctrl+Shift+L` quick-opens the overlay |
| **Agent tool** | The LLM can call `llama_switch(action="switch", model="...")` to switch models itself |
| **Inline footer status** | Status indicator (`●`/`⟳`/`◌`) shown inline next to the model name in the footer |
| **Config sync** | Upsert full model metadata from the admin API into Pi's config, including reasoning/thinking toggles |

## Prerequisites

- **llama-switch-manager** running and accessible (admin API on port 8090, model endpoint on 8080)
- Pi's `llama-cpp` provider configured to point at the switcher's model endpoint (port 8080)

See the switcher docs at `~/brain/vault/Infrastructure/llm-tuning/llama-switch.md` for setup details.

## Installation

Already installed at `~/.pi/agent/extensions/llama-switch/`. Pi auto-discovers it on startup.

To install elsewhere, place the `llama-switch/` directory (with `index.ts` inside) in any Pi extension path:

- `~/.pi/agent/extensions/llama-switch/` — global (all projects)
- `.pi/extensions/llama-switch/` — project-local

Reload with `/reload` in Pi to pick up changes.

## Configuration

Three ways to configure, in priority order:

### 1. Environment Variable

```bash
export LLAMA_SWITCH_HOST=<llama-server-host>:8090
```

Supports `host:port` or just `host` (defaults to port 8090). This is the same env var used by the `llama-switch` CLI tool.

### 2. Config File

Create `~/.pi/agent/llama-switch.json`:

```json
{
  "host": "<llama-server-host>",
  "port": 8090,
  "provider": "llama-cpp"
}
```

| Field | Default | Description |
|-------|---------|-------------|
| `host` | `localhost` | Hostname or IP of the llama-switch-manager |
| `port` | `8090` | Admin API port |
| `provider` | `llama-cpp` | Pi provider key for llama.cpp models |

### 3. Defaults

If neither env var nor config file is present: `localhost:8090`, provider `llama-cpp`.

## Usage

### Switching Models

#### Via Pi's Standard Selector (recommended)

Just use `/model` or `Ctrl+P` to pick a `llama-cpp` model. The extension intercepts the selection and switches the server automatically.

```
/model qwen3-coder-next
  → extension POSTs /switch/qwen3-coder-next to admin API
  → polls /status until server is ready
  → shows ● qwen3-coder-next in footer
```

#### Via `/llama-switch` Command

Opens an interactive overlay:

```
/llama-switch          # show overlay
/llama-switch qwen36-27b   # switch directly (by admin name or pi_id)
```

In the overlay:
- **↑↓** Navigate model list
- **Enter** Select a model or action
- **Esc** Cancel
- **Tab** (with args) Complete model names

Overlay actions:
- **Refresh status** — re-fetch from admin API
- **Stop server** — shutdown llama.cpp (with confirmation)
- **Sync Pi model config** — upsert admin API models into `models.json` and `enabledModels` in `settings.json`, including `reasoning`, `thinkingLevelMap`, `compat`, image support, context, and max-token metadata (then reload Pi)
- **Show config** — display current host/port/provider

#### Via Keyboard Shortcut

`Ctrl+Shift+L` — quick-open the overlay from anywhere.

#### Via Agent Tool

The agent can call the `llama_switch` tool:

```
llama_switch(action="list")        # list all models + server status
llama_switch(action="status")      # show current server status
llama_switch(action="switch", model="qwen36-27b")  # switch model
llama_switch(action="stop")        # stop the server
```

Use `model` with either the admin alias (e.g. `qwen36-27b`) or Pi model id (e.g. `qwen3.6-27b`).

### Footer Status

The extension shows a status indicator inline with the model name on the right side of Pi's footer:

```
>                         llama-cpp/qwen3.6-27b (main) ●
```

| Indicator | Meaning |
|-----------|---------|
| `●` (green) | Server running, ready |
| `⟳` (yellow) | Server loading model or switching |
| `◌` (dim) | Server not running |

Status refreshes every 10 seconds.

### Remote Devices

When running Pi on a laptop or other device on the same LAN:

1. Set `LLAMA_SWITCH_HOST=<llama-server-host>` (desktop's IP) in the environment
2. The extension connects to the desktop's admin API
3. Model switches, status, and config sync all work remotely
4. Pi's `llama-cpp` provider should point at `http://<llama-server-host>:8080/v1`

### Syncing Model Config on Remote Pi Devices

When you add or change a model in `~/.local/llama-switch/models.json` on the desktop/server, remote Pi clients can pull the updated model metadata over the LAN:

1. Ensure the desktop/server is running `llama-switch-manager.service` and the updated manager code.
2. On the remote device, set `LLAMA_SWITCH_HOST=<desktop-ip>` or create `~/.pi/agent/llama-switch.json`.
3. Run `/llama-switch sync` or open `/llama-switch` and select **Sync Pi model config**.
4. Confirm reload when prompted, or run `/reload` manually.

The sync upserts the full Pi model entries from the admin API, including `reasoning`, `thinkingLevelMap`, `compat.thinkingFormat`, `compat.maxTokensField`, image support, context, and max-token metadata. It updates existing entries instead of skipping them, removes old `llama-cpp-*` per-model providers, and keeps `enabledModels` aligned so reasoning-level changes propagate to already-provisioned models.

## Architecture

```
You (Pi)                    llama-switch-manager          llama.cpp
    │                              │                          │
    │  model_select (Pi event)     │                          │
    ├─────────────────────────────►│                          │
    │                              │  POST /switch/<model>    │
    │                              ├─────────────────────────►│
    │                              │  (reload with new model) │
    │                              │                          │
    │  poll /status                │  GET /status             │
    │◄─────────────────────────────┤  (ready + model name)    │
    │                              │                          │
    │  setModel()                  │                          │
    │  (update Pi active model)    │                          │
    │                              │                          │
    │  /llama-switch sync          │  GET /models             │
    ├─────────────────────────────►│                          │
    │  upsert full Pi metadata     │                          │
    │  into local models.json      │                          │
```

### Key Design Decisions

- **Communicates via admin API only** — never manipulates systemd services or local files on the server side. Safe for remote use.
- **Polls until ready** — after switching, polls `/status` (30s max) to confirm the new model is loaded before updating Pi's active model.
- **Idempotent** — re-selecting the already-active model is a no-op.
- **Concurrent guard** — a `switching` flag prevents race conditions between `model_select` hooks and manual overlay switches.

## Files

| File | Purpose |
|------|---------|
| `index.ts` | Extension entry point (auto-discovered by Pi) |
| `~/.pi/agent/llama-switch.json` | Persistent config (optional) |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| Footer shows `llama-switch: ?` | Check that llama-switch-manager is running (`systemctl --user status llama-switch-manager`) |
| Footer shows wrong host | Check `~/.pi/agent/llama-switch.json` or `LLAMA_SWITCH_HOST` env var |
| Model not found error | Run `/llama-switch sync`, then reload Pi |
| Switch fails | Check manager logs: `~/.local/llama-switch/manager.log` |
| Extension not loading | Verify `~/.pi/agent/extensions/llama-switch/index.ts` exists; run `/reload` |
