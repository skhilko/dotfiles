---
name: web-search
description: "Search the live web, look up documentation, read web pages, fact-check claims, find current information, and browse news. USE WHEN: the user asks to search, find online, look something up, check docs, read a URL, verify facts, or check recent events. Also invoke proactively when you need to verify information, are unsure about an API or config, information may be outdated, a project changed recently, or you want to cross-check a claim before answering."
---

# Web Search

Load [references/cli-reference.md](references/cli-reference.md) when you need: the full Goggles DSL (wildcards, stdin piping, file-based goggles), POI details by ID, or config/proxy internals.

**Tool:** `bx` (Brave Search CLI). Requires a Brave Search API key.

## Core Workflow

1. **Search with extracted content** — `bx "query" --max-urls 5 --max-tokens 4096`. The default `context` command returns pre-extracted, token-budgeted page text in `.grounding.generic[].snippets[]`, so you usually do not need a separate fetch step.
2. **Triage raw results first** — when you need to scan titles/URLs before picking one, use `bx web "query" --count 5`. Then pass a chosen URL back to `context` to read it.
3. **Read a specific URL deeply** — pass the URL as the query to `context`. See the Reading section below for the full pattern.
4. **Narrow when results are too broad** — tighten with `--threshold strict`, constrain domains with `--include-site`, or use Goggles.
5. **Fall back when `bx` returns nothing useful** — paywalls, login walls, heavy JavaScript, or unindexed pages. Use `curl` or another fetch method as last resort.

## When to Use Which Command

| Your need | Command | Why |
|--|--|--|
| Look up docs, errors, code patterns | `bx "query"` | Pre-extracted text, token-budgeted (default) |
| Search specific sites and read content | `bx "query" --include-site docs.rs` | Context extraction + domain allowlist |
| Use search operators (`site:`, `intitle:`) | `bx web "site:docs.rs" --operators` | Requires `--operators` flag; raw triage, then pass URLs to `context` |
| Traditional search results | `bx web "query"` | All result types (web, news, discussions) |
| Find discussions/forums | `bx web "query" --result-filter discussions` | Forums often have solutions |
| Latest news / recent events | `bx news "query" --freshness pd` | Fresh info beyond training data |
| Location-aware search | `bx "query" --city "Paris" --lat 48.85 --long 2.35` | `--city`, `--state`, `--lat`, `--long`, `--postal-code` |
| Find images | `bx images "query"` | Up to 200 results with thumbnails |
| Find videos | `bx videos "query"` | Results with duration, views, creator |
| Find places / businesses | `bx places "coffee" --location "San Francisco"` | Local POI search |
| Refine a search query | `bx suggest "query"` | Autocomplete suggestions |
| Check spelling | `bx spellcheck "qurey"` | Corrects misspelled queries |
| Boost/filter domains or paths | `bx "query" --goggles ...` | Custom re-ranking/allowlisting |

## Token Budget Control

| Flag | Default | What it does |
|--|--|--|
| `--count` | 20 | Results to consider before extracting (1-50) |
| `--max-tokens` | 8192 | Total tokens to return (1024-32768) |
| `--max-tokens-per-url` | 4096 | Max per URL (512-8192) |
| `--max-urls` | 20 | Max URLs in response (1-50) |
| `--max-snippets` | 50 | Max snippets across all URLs |
| `--threshold` | balanced | Relevance: `strict`, `balanced`, `lenient` |

## Parsing Output

All output is JSON. Use `jq` to read it:

```bash
# Pretty-print snippets from context results
bx "query" --max-urls 5 | jq -r '.grounding.generic[] | "\n\(.title)\n\(.url)\n" + (.snippets[:2][]? | "  - " + .)'

# Triage raw web results
bx web "query" --count 5 | jq -r '.web.results[] | "\n\(.title)\n\(.url)"'
```

## Goggles — Boost or Block Domains

Quick shortcuts:
```bash
# Only these domains
bx "rust axum" --include-site docs.rs --include-site github.com

# Exclude a domain
bx "python tutorial" --exclude-site example.com
```

Inline rules (mutually exclusive with `--include-site`/`--exclude-site`):
```bash
# Boost official docs, demote blog posts
bx "axum middleware tower" \
  --goggles '$boost=5,site=docs.rs
$boost=3,site=github.com
/docs/$boost=5
/blog/$downrank=3' --max-tokens 4096

# Allowlist mode — only matched sites
bx "Python asyncio patterns" \
  --goggles '$discard
$boost,site=docs.python.org
$boost,site=peps.python.org' --max-tokens 4096
```

Quick DSL: `$boost=N,site=DOMAIN` (promote), `$downrank=N,site=DOMAIN` (demote), `$discard,site=DOMAIN` (remove), `/path/$boost=N` (path matching), `$discard` as last rule for allowlist mode. See [references](references/cli-reference.md) for wildcards, stdin piping, and file-based goggles.

## JSON Response Shapes

**`bx "query"`** (context — default):
```json
{
  "grounding": { "generic": [{ "url": "...", "title": "...", "snippets": ["..."] }] },
  "sources": { "https://...": { "title": "...", "hostname": "...", "age": [...] } }
}
```

**`bx web "query"`** (raw results):
```json
{
  "web": { "results": [{ "title": "...", "url": "...", "description": "..." }] },
  "news": { "results": [...] },
  "videos": { "results": [...] },
  "discussions": { "results": [...] }
}
```

## Exit Codes

| Code | Meaning | Action |
|--|--|--|
| 0 | Success | Process results |
| 1 | Client error | Fix query/parameters |
| 2 | Usage error | Fix CLI arguments |
| 3 | Auth error (401/403) | Check API key |
| 4 | Rate limited (429) | Retry after delay |
| 5 | Server/network error | Retry with backoff |

## Reading / Visiting Search Results

Pass a URL as the query to read it deeply:
```bash
bx "https://docs.python.org/3/library/..." \
  --max-urls 1 --max-tokens 8192 --max-tokens-per-url 8192 \
  --max-snippets 10 --threshold strict
```

There is no `bx open`/`bx fetch`. Try URL-as-`context` before `curl`, but verify the returned `.grounding.generic[].url` matches the requested page. Fall back to `curl` for paywalls, login walls, heavy JS, unindexed, or mismatched pages.

Recommended search → read loop:
```bash
# 1. Search with extracted snippets
bx "Python 3.14 t-strings official docs" --count 20 --max-urls 5 --max-tokens 4096
# 2. Results weak? Increase recall, keep output small
bx "Python 3.14 t-strings official docs" --count 50 --max-urls 5 --threshold lenient
# 3. Need authoritative sources? Constrain by domain
bx "Python 3.14 t-strings official docs" --include-site docs.python.org --max-urls 5
# 4. Read a chosen URL by passing the URL to context
bx "https://docs.python.org/3/library/..." --max-urls 1 --max-tokens-per-url 8192 --max-snippets-per-url 10
```

## Examples

**User:** *"what are the breaking changes in Next.js 15?"*
```bash
bx "Next.js 15 breaking changes migration guide" --max-urls 5 --max-tokens 4096
```

**User:** *"search for the official Rust async book chapter on channels"*
```bash
bx "Rust async book channels" --include-site rust-lang.org --include-site docs.rs --max-urls 5
```

**User:** *"check the latest news about the Python 3.14 release"*
```bash
bx news "Python 3.14 release" --freshness pd
```
