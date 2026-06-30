---
name: brain-core
description: "The 7-phase Algorithm for structured task execution plus spec templates for defining done. USE WHEN: planning complex work, building multi-step solutions, refactoring, debugging with multiple hypotheses, research with synthesis, architectural decisions, writing specs, any task where 3+ steps or done is unclear. Also invoke proactively when task scope expands or done is unclear mid-work. NOT FOR: simple one-step actions, direct answers, single file reads, one-line edits, trivial lookups."
---

# Brain Core — Structured Execution

## The Algorithm

Follow these phases for every non-trivial task. Quick answers, simple reads, and one-line edits — do those directly. You don't need to announce the phases — just follow the discipline.

### 1. Observe

Reverse-engineer the request. What is the user actually asking for, including unstated requirements?

- Read relevant AGENTS.md, README, or prior context if scope is unclear
- Identify the domain (Personal, Mroja, Infrastructure, Ops)
- Generate **criteria** — testable conditions that, when all true, mean the task is done

```
Criteria:
- #1: [what is true when met] — verify: [how to check]
- #2: ...
```

### 2. Think

Before acting, check:
- What am I assuming that I haven't verified?
- What could go wrong?
- Do I have enough context, or do I need to read something first?
- Are there simpler approaches I'm skipping?

### 3. Plan

Design the approach. Order the steps. Note which can run in parallel.

For anything beyond a quick task, **write a spec** first. See template below.

### 4. Build

Construct the solution, one piece at a time. Re-read criteria before each artifact to prevent drift.

### 5. Execute

Run commands, create files, apply edits. Track criteria as they pass.

### 6. Verify

For each criterion, produce **evidence** it is met. Do not assume.

- Code compiles / tests pass / grep confirms / file has expected content
- If a criterion fails, fix it and re-verify
- Task is complete only when every criterion passes

### 7. Learn

One-line reflection: what worked, what to do differently, any pattern worth remembering.

## Effort Tiers

Pick the tier that matches the task. It controls depth, not ceremony.

| Tier | When | Approach |
|------|------|----------|
| T1 — Quick | One file, clear outcome | Observe + Build + Verify (skip Think for obvious tasks) |
| T2 — Standard | Multi-file or multi-step | Full algorithm, inline criteria |
| T3 — Deep | Research, architecture, complex systems | Full algorithm + written spec + extended Think with alternatives |

## Task Spec

For T2+ tasks, write a spec before building. Embed it in `tasks.md`, `overview.md`, or a dedicated note near the work.

```markdown
## Spec: <task name>

**Goal:** <one sentence — what success looks like>

**Criteria:**
- [ ] #1: <testable condition> — verify: <how to check>
- [ ] #2: ...

**Constraints:** <what must not change, scope limits>

**Verification:**
- #1: [ ] pass — <evidence>
- #2: ...
```

Keep specs close to the work they describe. A task spec lives in the initiative's `tasks.md` or `overview.md`. A project spec lives in the project's root note.

## Example

**User:** "I need rate limiting on the API endpoints so we don't get hammered by scrapers."

**Observe** → Domain: Ops. Criteria: (1) requests capped per IP per minute, (2) returns 429 when exceeded, (3) config is in env vars, (4) existing endpoints unaffected.

**Think** → Assuming middleware supports per-route hooks. Could go wrong: bursty legitimate traffic, existing clients not handling 429. Need to check current middleware stack first.

**Plan** → T2. Steps: read current middleware → add rate-limit module → configure via env → add 429 handler → test.

**Build** → Add `rate-limit.js` middleware, wire into `server.js`.

**Execute** → `npm install express-rate-limit`, edit middleware, restart.

**Verify** → `curl -i localhost:3000/api` × N → confirms 429 after threshold. Grep confirms env var wiring. All 4 criteria pass.

**Learn** → Rate limiting middleware was simpler than expected; next time check for built-in support before adding deps.
