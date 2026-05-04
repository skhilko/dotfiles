---
name: session-retrospective
description: Analyze previous Pi chat/session JSONL transcripts to identify agent inefficiencies, tool gaps, unexpected issues, user-intent misunderstandings, context/documentation misses, and concrete improvements to Pi harness extensions, skills, AGENTS.md, and docs. Use when asked to review, audit, postmortem, or learn from a prior agent session.
---

# Session Retrospective

Use this skill to turn a prior Pi session into evidence-backed improvements for future sessions.

## Core Workflow

1. **Identify the target session.**
   - If the user provides a path or session ID, use it.
   - If the user gives a number from a session list, map it to the printed path from that list.
   - If the user invokes this skill without a target, asks “which session?”, or asks to choose/select a session, list recent sessions and ask them to pick one; do not silently analyze the latest session.
   - If they say “previous session”, list recent sessions first when practical; the current session may be the newest file, so confirm the target if there is any ambiguity.
   - Prefer the same working directory unless the user says otherwise.

2. **Generate a local session digest.**
   Run the helper script below. Its path is relative to this skill directory; keep `--cwd` set to the user's project/session cwd, not the skill directory.
   ```bash
   # Selection flow: show this list, then ask the user to choose a number/path/id.
   python3 scripts/analyze_pi_session.py --list --cwd "$(pwd)"

   # Direct analysis after the target is known.
   python3 scripts/analyze_pi_session.py --previous --cwd "$(pwd)" --markdown
   python3 scripts/analyze_pi_session.py /path/to/session.jsonl --markdown
   ```
   Use `--max-events N`, `--content-chars N`, or `--full` when needed.

3. **Inspect only what is needed.**
   After the digest identifies likely improvement targets, read relevant files such as:
   - global/project `AGENTS.md`
   - existing skills under `~/.pi/agent/skills/` or project skill directories
   - Pi docs/source files only if the proposed change depends on harness behavior
   - project READMEs or docs implicated by the session

4. **Analyze with evidence.**
   Cite session entry IDs, timestamps, tool names, command snippets, and transcript snippets. Do not invent failures not supported by the session.

5. **Recommend improvements by action type.**
   Categorize findings as:
   - **Harness/tooling gap:** missing tool, extension opportunity, command UX issue, session analysis gap, tool output/truncation problem.
   - **Skill gap:** missing workflow instructions, poor trigger description, helper script needed, skill too broad/narrow.
   - **AGENTS.md/context gap:** repo convention, verification command, safety rule, or workflow not documented.
   - **Documentation gap:** user-facing docs should explain a recurring workflow or constraint.
   - **Agent process issue:** insufficient discovery, over-exploration, weak plan, premature edits, bad verification, failure recovery.
   - **User-intent mismatch:** ambiguity not clarified, wrong assumption, missed stated constraint.
   - **Environment/operational issue:** permissions, missing dependencies, flaky network, long-running commands, destructive action risk.

6. **Prioritize fixes.**
   Use impact/effort/safety:
   - High impact + low effort first.
   - Prefer small AGENTS.md/skill/docs updates over new extensions unless the session shows repeated, costly manual work.
   - Recommend harness changes only when a skill/doc update cannot prevent the inefficiency.
   - Avoid overfitting to one unusual session.

## Output Format

When the user asks for an analysis, produce:

```markdown
# Session Retrospective

## Target
- Session: <path or id>
- Scope: <what was reviewed>

## Executive Summary
- <3-5 bullets on what slowed the session and what would help most>

## Evidence-Backed Findings
| Severity | Category | Evidence | Inefficiency | Recommended fix |
|---|---|---|---|---|
| High/Med/Low | ... | entry/tool/timestamp | ... | ... |

## Recommended Changes
1. <specific file/tool/skill/doc change> — impact/effort/risk
2. ...

## Not Worth Changing Yet
- <items that are one-off, too speculative, or better handled ad hoc>

## Optional Implementation Plan
- <small ordered edits if the user wants changes applied>
```

When the user asks you to implement improvements, make surgical edits and verify them. For skill changes, respect the Agent Skills frontmatter rules: lowercase hyphenated name, parent directory name match, and a specific description.

## Review Heuristics

Look for these inefficiency signals:

- Repeated failed `edit` attempts, exact-match misses, or broad rewrites where targeted edits would work.
- Multiple `ls/find/grep/read` calls that a missing project map, AGENTS.md note, or helper command could avoid.
- `command not found`, missing dependency, permission denied, timeouts, rate limits, network failures, or truncated output.
- The agent reads documentation late, ignores AGENTS.md, or misses obvious manifests/test configs.
- User corrections indicating misunderstood scope, terminology, output format, or risk tolerance.
- Long detours caused by lack of a domain-specific tool, browser/search tool, parser, formatter, test runner, or session-inspection helper.
- Verification skipped or poorly matched to the change.
- Large context/token usage from unfiltered file reads or verbose command output.
- A recurring workflow that could become a skill, prompt template, extension command, or AGENTS.md checklist.

## Safety and Privacy

Session files may contain private code, secrets, prompts, or pasted data. Keep analysis local unless the user explicitly asks to share/export. Redact secrets in summaries and recommendations.
