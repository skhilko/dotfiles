---
name: web-search
description: >-
  Search the live web, look up documentation, read web pages, fact-check claims,
  find current information, and browse news. Use when the user asks to search,
  find online, look something up, check current docs, read a URL, verify facts
  against the web, check recent events or news, or needs information beyond
  training data.
---

# bx — Brave Search CLI

Official CLI docs: <https://github.com/brave/brave-search-cli/blob/main/README.md>

**Use `bx` for all web searches.** Default to `bx "query"` (`context`): it searches and returns pre-extracted, token-budgeted readable page content, so you usually do **not** need a separate browser/fetch/open step. For agent use, keep output bounded (for example `--max-urls 5 --max-tokens 4096`) and inspect `.grounding.generic[]`. Use `bx web` only for traditional/raw result triage, search operators, or result filters. If `bx` is not found, install it: `curl -fsSL https://raw.githubusercontent.com/brave/brave-search-cli/main/scripts/install.sh | sh`

> **Requires**: [Brave Search API Key](https://api.search.brave.com) + `bx` binary

## Quick Start

```bash
# Install (macOS/Linux)
curl -fsSL https://raw.githubusercontent.com/brave/brave-search-cli/main/scripts/install.sh | sh

# Configure API key (get one at https://api-dashboard.search.brave.com)
bx config set-key              # interactive (avoids shell history)
# or: bx config set-key YOUR_API_KEY
# or: export BRAVE_SEARCH_API_KEY=YOUR_KEY

# Search (default = bx context "query")
bx "your search query"
```

## Reading / Visiting Search Results

`bx "query"` (`context`) already searches and extracts readable page text into `.grounding.generic[].snippets[]`. Prefer it over `bx web` when you need to *read* results; `bx web` is for raw rankings/result types and usually requires a second step to get page text. Context snippets can include plain text, code, tables, and JSON-like structured data. Start with a few URLs/snippets to avoid overwhelming output, then raise limits only when needed.

To "open" or read one specific result URL more deeply, pass the URL back to `context`:

```bash
bx "https://docs.python.org/3/library/string.templatelib.html" \
  --max-urls 1 --max-tokens 8192 --max-tokens-per-url 8192 \
  --max-snippets 10 --threshold strict
```

Recommended search → read loop:

```bash
# 1. Search with extracted snippets
bx "Python 3.14 t-strings official documentation examples" --count 20 --max-urls 5 --max-tokens 4096

# 2. If results are weak, increase candidate recall but keep output small
bx "Python 3.14 t-strings official documentation examples" --count 50 --max-urls 5 --threshold lenient

# 3. If you need authoritative/source-specific pages, constrain early
#    (broad web searches may surface tutorials/blogs before official docs)
bx "Python 3.14 t-strings official documentation examples" --include-site docs.python.org --max-urls 5

# 4. Read/open a chosen URL by querying the URL itself
bx "https://docs.python.org/3/library/string.templatelib.html" --max-urls 1 --max-tokens-per-url 8192 --max-snippets-per-url 10
```

There is no separate `bx open`/`bx fetch` command. Try URL-as-`context` before inventing `curl`/HTML scraping, but verify the returned `.grounding.generic[].url` matches the requested page/domain. Fall back to the canonical raw/source URL or another fetch/extraction method when `bx` returns no usable content **or an obviously different/mismatched page** (for example: not indexed, requires login, heavy JavaScript, paywall, blocked page, or some GitHub `blob`/`raw` URLs).

Use `jq` to inspect context results:

```bash
bx "query" --max-urls 5 | jq -r '
  .grounding.generic[]
  | "\n\(.title)\n\(.url)",
    (.snippets[:2][]? | " - " + (gsub("\\s+"; " ")[:500]))
'
```

If you only need to triage URLs before choosing one to read, use `web` with raw-result controls, then pass the chosen URL back to `context`:

```bash
bx web "site:docs.python.org Python 3.14 t-strings" --operators --count 5 --extra-snippets \
  | jq -r '.web.results[] | "\n\(.title)\n\(.url)\n\(.description)"'
```

Search operators such as `site:`, `intitle:`, and similar Brave operators are a `web` feature; use `bx web ... --operators` for operator-scoped triage, then pass a chosen URL back to `context` to read it. For source-constrained readable content, prefer `bx "query" --include-site DOMAIN` or Goggles.

## When to Use Which Command

| Your need | Command | Why |
|--|--|--|
| Look up docs, errors, code patterns | `bx "query"` | Pre-extracted text, token-budgeted (default) |
| Search specific sites and read content | `bx "query" --include-site docs.rs` | Context extraction + domain allowlist |
| Use Brave search operators or result filters | `bx web "site:docs.rs axum" --operators` | Raw triage; pass chosen URLs back to `context` |
| Traditional search results | `bx web "query"` | All result types (web, news, discussions, etc.) |
| Find discussions/forums | `bx web "query" --result-filter discussions` | Forums often have solutions |
| Latest news / recent events | `bx news "query" --freshness pd` | Fresh info beyond training data |
| Find images | `bx images "query"` | Up to 200 results |
| Find videos | `bx videos "query"` | Duration, views, creator |
| Local businesses / places | `bx places "coffee" --location "San Francisco CA US"` | 200M+ POIs |
| Place details/descriptions | `bx pois ID`; `bx descriptions ID` | Use IDs from `places` results |
| Boost/filter domains or paths | `bx "query" --goggles ...` | Full custom re-ranking/allowlisting |

## Commands

| Command | Description | Output path |
|--|--|--|
| `context` | **Default.** RAG/LLM grounding — pre-extracted web content | `.grounding.generic[]` -> `{url, title, snippets[]}` |
| `web` | Web search — all result types/operators/filters | `.web.results[]`, `.news.results[]`, etc. |
| `news` | News articles with freshness filters | `.results[]` -> `{title, url, age}` |
| `images` | Image search (up to 200 results) | `.results[]` -> `{title, url, thumbnail.src}` |
| `videos` | Video search with duration/views | `.results[]` -> `{title, url, video.duration}` |
| `places` | Local place/POI search (200M+ POIs) | `.results[]` -> `{title, postal_address, contact}` |
| `pois` | POI details by ID | Use IDs from `places` |
| `descriptions` | AI-generated POI descriptions by ID | `.results[].description` |
| `config` | Manage API key and settings | `set-key`, `show-key`, `path`, `show` |

## Response Shapes

**`bx "query"`** (context — default, recommended)
```json
{
  "grounding": {
    "generic": [
      { "url": "...", "title": "...", "snippets": ["extracted content...", "..."] }
    ]
  },
  "sources": {
    "https://example.com": { "title": "...", "hostname": "...", "age": ["...", "2025-01-15", "392 days ago"] }
  }
}
```

**`bx web "query"`** (full search results)
```json
{
  "web": { "results": [{"title": "...", "url": "...", "description": "..."}] },
  "news": { "results": [...] },
  "videos": { "results": [...] },
  "discussions": { "results": [...] }
}
```

## Token Budget Control

Control search breadth and output size for context (the default command):

| Flag | Short alias | Default | Description |
|--|--|--|--|
| `--count` | — | 20 | Search results to consider before extracting context (1-50) |
| `--maximum-number-of-tokens` | `--max-tokens` | 8192 | Approximate total tokens (1024-32768) |
| `--maximum-number-of-tokens-per-url` | `--max-tokens-per-url` | 4096 | Max tokens per URL (512-8192) |
| `--maximum-number-of-urls` | `--max-urls` | 20 | Max URLs in response (1-50) |
| `--maximum-number-of-snippets` | `--max-snippets` | 50 | Max snippets across all URLs |
| `--maximum-number-of-snippets-per-url` | `--max-snippets-per-url` | — | Max snippets per URL |
| `--context-threshold-mode` | `--threshold` | balanced | Relevance: `strict`, `balanced`, `lenient` |

```bash
bx "topic" --max-tokens 4096 --max-tokens-per-url 1024 --max-urls 5 --threshold strict
```

## Goggles — Custom Ranking

Goggles let you control which sources appear in results. Boost official docs, suppress SEO spam, or build focused search scopes. **No other search tool offers this.** Supported on `context`, `web`, and `news`.

### Domain Shortcuts

```bash
# Allowlist — only results from these domains
bx "rust axum" --include-site docs.rs --include-site github.com

# Blocklist — exclude specific domains
bx "python tutorial" --exclude-site example.com
```

`--include-site`, `--exclude-site`, and `--goggles` are mutually exclusive.

### Inline Rules

```bash
# Boost official docs, demote blog posts
bx "axum middleware tower" \
  --goggles '$boost=5,site=docs.rs
$boost=3,site=github.com
/docs/$boost=5
/blog/$downrank=3' --max-tokens 4096

# Allowlist mode — only include matched sites
bx "Python asyncio patterns" \
  --goggles '$boost=5,site=docs.python.org
$boost=5,site=peps.python.org
$discard'
```

### DSL Quick Reference

| Rule | Effect | Example |
|--|--|--|
| `$boost=N,site=DOMAIN` | Promote domain (N=1-10) | `$boost=3,site=docs.rs` |
| `$downrank=N,site=DOMAIN` | Demote domain (N=1-10) | `$downrank=5,site=example.com` |
| `$discard,site=DOMAIN` | Remove domain entirely | `$discard,site=example.com` |
| `/path/$boost=N` | Boost matching URL paths | `/docs/$boost=5` |
| `*pattern*$boost=N` | Wildcard URL matching | `*api*$boost=3` |
| Generic `$discard` | Allowlist mode — discard unmatched | `$discard` (as last rule) |

Separate rules with newlines. Full DSL and pattern syntax: [goggles-quickstart](https://github.com/brave/goggles-quickstart).

### Piping Rules via Stdin

```bash
echo '$boost=5,site=docs.rs
$boost=5,site=crates.io
$boost=3,site=github.com' | bx "axum middleware" --goggles @- --max-tokens 4096
```

Use `@/path/to/file` to reuse a goggle across queries. Hosted raw `.goggle` URLs are also supported.

## Agent Workflow Examples

**Debugging an error:**
```bash
bx "Python TypeError cannot unpack non-iterable NoneType" --max-tokens 4096
```

**Corrective RAG loop:**
```bash
# 1. Broad search
bx "axum middleware authentication" --max-tokens 4096
# 2. Too general? Narrow with strict threshold
bx "axum middleware tower layer authentication example" --threshold strict --max-tokens 4096
# 3. Need authoritative sources? Constrain by domain
bx "axum middleware tower layer authentication example" --include-site docs.rs --include-site github.com --max-tokens 4096
```

**Checking for breaking changes before upgrading:**
```bash
bx "Next.js 15 breaking changes migration guide" --max-tokens 8192
bx news "Next.js 15 release" --freshness pm
```

## Exit Codes

| Code | Meaning | Agent action |
|--|--|--|
| 0 | Success | Process results |
| 1 | Client error (bad request) | Fix query/parameters |
| 2 | Usage error (bad flags) | Fix CLI arguments |
| 3 | Auth/permission error (401/403) | Check API key: `bx config show-key` |
| 4 | Rate limited (429) | Retry after delay |
| 5 | Server/network error | Retry with backoff |

## Use Cases

- **AI agents / coding assistants**: One-call web search with token-budgeted, RAG-ready content — replaces search + scrape + extract
- **Fact-checking**: Verify claims against current web content with `bx "query" --threshold strict`
- **Documentation lookup**: Search official docs with `--include-site` or Goggles domain boosting
- **Debugging**: Search for error messages and stack traces directly
- **News monitoring**: Track topics with `bx news "query" --freshness pd`
- **Local search**: Find businesses and places with `bx places "query" --location "city"`

## Notes

- **All output is JSON** to stdout; errors go to stderr with a human-readable summary, hints, and the JSON error body
- **Config precedence**: CLI flag > environment variable > config file > default. Prefer `BRAVE_SEARCH_API_KEY` or `bx config set-key` over `--api-key` because command-line flags are visible in process listings.
- **Global flags**: `--config PATH`, `--api-key KEY`, `--base-url URL`, `--timeout SECS` (default 30), `--extra KEY=VALUE` (repeatable, auto-types POST values), `--endpoint PATH`
- **Local proxy**: `BRAVE_SEARCH_BASE_URL`/`--base-url` may point to loopback HTTP URLs such as `http://127.0.0.1:8080/brave`; non-loopback `http://` URLs are rejected.
- **Search operators**: `site:`, `intitle:`, etc. are for `bx web ... --operators`; use `--include-site`/Goggles on `context` when you need extracted readable content.
- **Location awareness**: `context` and `web` support `--lat`, `--long`, `--city`, `--state`, `--state-name`, `--loc-country`, `--postal-code`, `--timezone`; `places` uses `--location` or `--latitude`/`--longitude`.
- **Query equals command name**: use `bx -- web` or `bx context "web"` to search for a word that matches a subcommand.
- **Help**: `bx --help` for all commands; `bx <command> --help` for per-command flags
