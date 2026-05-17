/**
 * Edit Batching Extension
 *
 * Overrides the built-in `edit` tool to inject stronger, more operational
 * batching guidance into the system prompt. The original tool behavior
 * (execute, rendering, schema) is fully preserved.
 *
 * Problem solved: models understand batching exists in theory, but under task
 * pressure make sequential single-edit calls. This extension replaces passive
 * constraint-language ("use one call when…") with an explicit decision checklist
 * the model evaluates before every edit.
 *
 * Placement: ~/.pi/agent/extensions/edit-batching/
 * Reload: /reload
 */

import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { createEditToolDefinition } from "@earendil-works/pi-coding-agent";

// ---------------------------------------------------------------------------
// Improved prompt guidelines — operational, not passive
// ---------------------------------------------------------------------------

const EDIT_BATCHING_GUIDELINES: string[] = [
	`Before calling edit, check whether you already know multiple replacements for the same file. If yes, put them all in one edits[] array.`,
	`Use a second edit call for the same file only after new information arrives: formatter/test output, exact-match failure, re-read, or newly discovered required change.`,
	`Each edits[].oldText is matched against the original file, not after earlier edits in the same call. Merge overlapping, nested, adjacent, or dependent changes into one edit.`,
	`Keep edits[].oldText minimal but unique. Do not pad with large unchanged regions.`,
];

// ---------------------------------------------------------------------------
// Cache built-in edit definitions by cwd so the execute closure gets the
// correct working directory. Follows the pattern from minimal-mode.ts.
// ---------------------------------------------------------------------------

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { EditToolDetails, EditToolInput } from "@earendil-works/pi-coding-agent";

const editToolCache = new Map<
	string,
	ToolDefinition<any, EditToolDetails | undefined, any>
>();

function getEditTool(cwd: string): ToolDefinition<any, EditToolDetails | undefined, any> {
	let def = editToolCache.get(cwd);
	if (!def) {
		def = createEditToolDefinition(cwd);
		editToolCache.set(cwd, def);
	}
	return def;
}

// ---------------------------------------------------------------------------
// Extension factory
// ---------------------------------------------------------------------------

export default function (pi: ExtensionAPI) {
	pi.on("session_start", async (_event, ctx) => {
		pi.registerTool({
			// Same name as built-in — this fully replaces it
			name: "edit",

			label: "edit",

			// Description stays identical to the built-in
			description:
				"Edit a single file using exact text replacement. Every edits[].oldText must match a unique, non-overlapping region of the original file. If two changes affect the same block or nearby lines, merge them into one edit instead of emitting overlapping edits. Do not include large unchanged regions just to connect distant changes.",

			// promptSnippet — one-line entry in "Available tools"
			promptSnippet:
				"Make precise file edits with exact text replacement; batch multiple disjoint edits to one file in one call",

			// promptGuidelines — THIS is what we override
			promptGuidelines: EDIT_BATCHING_GUIDELINES,

			// Schema, argument preparation, and execution mode from built-in
			parameters: getEditTool(ctx.cwd).parameters,
			prepareArguments: getEditTool(ctx.cwd).prepareArguments,
			renderShell: "self" as const,

			// Delegate execution to the built-in (resolve cwd at call time)
			async execute(toolCallId, params, signal, onUpdate, execCtx) {
				return getEditTool(execCtx.cwd).execute!(
					toolCallId,
					params as EditToolInput,
					signal,
					onUpdate,
					execCtx,
				);
			},

			// Delegate rendering to the built-in (diff preview, error states, etc.)
			renderCall: getEditTool(ctx.cwd).renderCall,
			renderResult: getEditTool(ctx.cwd).renderResult,
		});
	});
}
