---
name: skill-builder
description: "Scaffold and create new Pi agent skills with proper frontmatter, descriptions, and structure. USE WHEN: creating a new skill, building a skill for X, adding a capability, updating an existing skill structure, or when asked to write a SKILL.md. NOT FOR: writing AGENTS.md files, prompt templates, or regular notes."
---

# Skill Builder

Follow this process every time you create a new skill. Do not skip the interview.

## Step 1 — Interview

Before writing a single line, understand what the skill should do. Ask or clarify:
- **What does this skill do?** One sentence, specific. What problem does it solve?
- **When should it activate?** 3-5 concrete trigger scenarios — phrases a real user would actually say.
- **When should it NOT activate?** Only if there are genuine false triggers to prevent (e.g. a "code-review" skill triggering on "review my vacation plans"). Skip if the skill is self-evidently narrow.
- **Does it need helper scripts, reference docs, or assets?** Or is it pure instructions (SKILL.md only)?
- **What are the edge cases?** Input formats, success criteria, failure modes.

Proactively ask about edge cases and dependencies. Come prepared — don't dump all the questions on the user.

## Step 2 — Create Structure

```bash
# Simple skill (most skills — pure instructions)
mkdir -p ~/.pi/agent/skills/skill-name

# Complex skill (with scripts, references, templates)
mkdir -p ~/.pi/agent/skills/skill-name/{scripts,references}
```

**Prefer simple skills.** Use `references/` only when detailed criteria or docs would make the SKILL.md body unwieldy. Aim for a lean body — under 40 lines when practical — but don't move essential operational knowledge to references just to hit a target. The agent needs everything it requires to use the skill effectively at trigger time. Lookup tables, full DSL references, niche subcommands, and config internals are good candidates for `references/`.

## Step 3 — Write SKILL.md

### Frontmatter

```markdown
---
name: skill-name
description: "<see rules in Step 4>"
---
```

| Field | Rules |
|-------|-------|
| `name` | 1-64 chars, lowercase + hyphens only, no leading/trailing/consecutive hyphens |
| `description` | **Required.** ≤500 chars. **Always wrap in double quotes** — unquoted `:` (e.g. `USE WHEN:`) breaks YAML parsing. All trigger info goes here, not in the body. |

### Body Template

```markdown
# Skill Name

## Core Workflow

<step-by-step instructions, imperative form>

## Examples

<concrete input/output examples>
```

**Writing rules for the body:**
- Use **imperative form**: "Read the file", not "You should read the file"
- Explain **why** things matter instead of heavy-handed MUST/ALWAYS/NEVER. Try to make the skill general, not narrow to specific examples.
- Include **concrete examples** with realistic inputs and expected outputs
- If detailed criteria or references exist, put them in `references/` and link: `See [references/criteria.md](references/criteria.md)`
- Keep the SKILL.md body lean. The body is only loaded after the skill triggers — don't waste tokens on "When to Use" sections (that belongs in the description)

## Step 4 — Write the Description

The description is the most important field — it's the only thing always in context and determines whether the skill activates.

**Structure:** summary → `USE WHEN:` triggers → `NOT FOR:` exclusions (optional)

**Rules:**
- ≤500 characters
- Include **concrete trigger phrases** the user actually says ("write a README", "review this code", "create a chart")
- Include **proactive/self-trigger cues** when the agent should invoke the skill on its own — e.g. "Also invoke when you need to verify X" or "Invoke proactively if Y is uncertain". Not every skill needs this, but skills for verification, searching, or checking should.
- `NOT FOR:` exclusions: only include when the skill could genuinely be confused with something else. If the name and summary make the scope self-evident (e.g. "web-search"), skip it — don't add exclusions just to fill the template.
- All "when to use" information belongs here, NOT in the body

**Good (with exclusions that matter):**
> The 7-phase Algorithm for structured task execution. USE WHEN: planning complex work, building multi-step solutions, debugging with multiple hypotheses, any task where 3+ steps or "done" is unclear. NOT FOR: simple one-step actions, direct answers, trivial lookups.

**Good (no exclusions needed):**
> Search the live web and look up documentation. USE WHEN: the user asks to search, find online, check docs, read a URL, or verify facts. Also invoke proactively when you need to verify information or are unsure about an API.

**Bad:**
> Helps with tasks. Use for complex work.

## Step 5 — Draft and Review

Write a draft, then look at it with fresh eyes and improve it:
- Is the description ≤500 chars and specific?
- Are `NOT FOR:` exclusions earned (genuine false triggers) or just padding?
- Does the description include proactive cues if the agent should self-trigger this skill?
- Are instructions in imperative form?
- Did I explain why, not just say MUST?
- Are examples realistic and concrete?
- Is the body lean (under 40 lines when practical)?
- Do references link to files that exist?

## Step 6 — Test

After creating the skill, verify it works:

1. **Frontmatter valid** — name matches rules, description ≤500 chars, description value is wrapped in double quotes
2. **Name matches directory** — standard convention
3. **References resolve** — all `references/` links point to existing files
4. **Trigger with realistic prompts** — try 2-3 natural language prompts that should match. If you included `NOT FOR:` exclusions, try prompts that should NOT match.
5. **Proactive trigger** — if the description includes self-trigger cues, verify the agent would invoke the skill on its own in a scenario where it needs to verify or look something up.

**Write realistic test prompts**, not abstract ones:
- Bad: `"Format this data"`, `"Extract text from PDF"`
- Good: `"ok so I have this CSV with sales data and I need a summary by region, can you pull the totals and flag anything under target?"`
