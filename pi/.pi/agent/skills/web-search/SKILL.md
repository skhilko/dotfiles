---
name: web-search
description: "Search the live web, look up documentation, read web pages, fact-check claims, find current information, and browse news. USE WHEN: the user asks to search, find online, look something up, check docs, read a URL, verify facts, or check recent events. Also invoke proactively when you need to verify information, are unsure about an API or config, information may be outdated, a project changed recently, or you want to cross-check a claim before answering."
---

# Web Search

Load [references/cli-reference.md](references/cli-reference.md) for: full Goggles DSL, all `bx` subcommands, token budget flags, `bx` exit codes, **and complete Firecrawl API reference** (all scrape/crawl/map options, actions reference, response structure).

**Tools:** `bx` (Brave Search CLI) + **Firecrawl** (self-hosted at `http://localhost:3002`).

- `bx` — discovery: search, news, images, video, places, suggestions, spellcheck
- **Firecrawl** — reading: live page rendering with Playwright, markdown extraction, structured data, site mapping, multi-page crawling, batch scraping

## The Two-Phase Workflow

**Phase 1 — Discover (bx):** Find relevant URLs via search.
**Phase 2 — Read (Firecrawl):** Fetch live, rendered page content from those URLs.

This replaces the old single-phase approach where `bx` returned stale index snippets. Firecrawl renders every page in a real browser — JavaScript, anti-bot challenges, dynamic content all handled live.

### Quick Decision Guide

| Scenario | Tool | Why |
|---|---|---|
| "Find me X" / "search for Y" | `bx` | Discovery by topic/keywords |
| "Read this URL" / "what's on this page" | **Firecrawl scrape** | Live, full-page rendering |
| "Search and show me the content" | **Firecrawl search** | Search + scrape in one call |
| `bx` snippets are stale/missing | `bx` → **Firecrawl** | Search to find URL, scrape for live content |
| Known site with JS rendering | **Firecrawl scrape** | Skip search; scrape the URL you know |
| "Find all product pages on example.com" | **Firecrawl map/crawl** | Discover URLs by crawling, not searching |
| News, images, video, places | `bx` | Firecrawl search has no media/place results |

## Phase 1 — Search with `bx`

### Core Commands

| Command | Output path | When to use |
|--|--|--|
| `bx "query"` (default: `context`) | `.grounding.generic[]` → `{url, title, snippets[]}` | Default for docs, errors, code — pre-extracted snippets, token-budgeted |
| `bx "query" --include-site example.com` | same | Context extraction + domain allowlist |
| `bx web "query" --count 5` | `.web.results[]` → `{url, title}` | Raw triage — scan titles/URLs, then pass URLs to Firecrawl |
| `bx web "query" --result-filter discussions` | same | Forums/discussions often have solutions |
| `bx web "site:docs.rs query" --operators` | same | Use search operators (`site:`, `intitle:`) |
| `bx news "query" --freshness pd` | `.results[]` → `{title, url, age}` | Latest news / recent events |
| `bx places "coffee" --location "San Francisco"` | `.results[]` → `{title, postal_address, contact}` | Local POI search |

**Narrow broad results** — tighten with `--threshold strict` or use Goggles (below).

**Tune output size** — `--max-urls 5` (URLs returned), `--max-tokens 4096` (total tokens). Full flags in cli-reference.md.

### Parsing `bx` Output

All output is JSON. Use `jq`:

```bash
# Pretty-print snippets from context results
bx "query" --max-urls 5 | jq -r '.grounding.generic[] | "\(.title)\n\(.url)\n" + (.snippets[:2][]? | "  - " + .)'

# Triage raw web results
bx web "query" --count 5 | jq -r '.web.results[] | "\(.title)\n\(.url)"'

# Extract URLs for piping to Firecrawl
bx web "query" --count 5 | jq -r '.web.results[:3][] | .url'
```

### Goggles — Boost or Block Domains

```bash
# Only these domains
bx "rust axum" --include-site docs.rs --include-site github.com

# Boost official docs, demote blog posts
bx "axum middleware tower" \
  --goggles '$boost=5,site=docs.rs
$boost=3,site=github.com
/docs/$boost=5
/blog/$downrank=3' --max-tokens 4096
```

## Phase 2 — Read with Firecrawl

Self-hosted at `http://localhost:3002` (v2.11). Renders pages in a real headless browser via Playwright — handles JavaScript, anti-bot challenges, dynamic content, SPAs, and paywalls. Self-hosted instances lack cloud-only "Fire-engine" (advanced proxy rotation).

### Endpoint Overview

| Endpoint | Method | What it does |
|--|--|--|
| `POST /v1/scrape` | sync | Scrape a single URL — returns immediately |
| `POST /v1/search` | sync | Search the web + optionally scrape results in one call |
| `POST /v1/map` | sync | Map a site — find all URLs without downloading content |
| `POST /v1/crawl` | async | Crawl a site — download content from multiple pages |
| `GET /v1/crawl/:id` | sync | Check crawl job status and results |
| `POST /v1/batch/scrape` | async | Queue multiple URLs for scraping (like crawl but URL-list-driven) |
| `GET /v1/batch/scrape/:id` | sync | Check batch scrape status and results |

Self-hosted search uses DuckDuckGo by default (SearXNG or Fire Engine if configured). No external API key needed.

### 1. Scrape a Single URL

```bash
# Basic scrape — returns markdown (default format)
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'

# Request multiple formats
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "formats": ["markdown", "html", "links"]}'
```

#### Output Formats

| Format | What it returns |
|--|--|
| `markdown` *(default)* | Clean markdown text |
| `html` | Cleaned HTML |
| `rawHtml` | Raw, unmodified HTML |
| `links` | Array of all links on the page |
| `screenshot` | Viewport screenshot (base64 PNG) |
| `screenshot@fullPage` | Full-page screenshot (base64 PNG) |
| `extract` | LLM-powered structured data extraction (requires API key) |

#### Content Control

```bash
# Keep only main content (default: true) — strips nav, footer, sidebar
"onlyMainContent": true

# Aggressive cleanup — remove ads, navbars, modals
"onlyCleanContent": true

# Include only specific HTML tags
"includeTags": ["article", "main"]

# Exclude specific HTML tags
"excludeTags": ["script", "style", "noscript"]

# Render mobile layout instead of desktop
"mobile": true

# Parse embedded PDFs
"parsePDF": true
```

#### Timing & Rendering

```bash
# Wait N ms after page load before capturing content (handles JS rendering)
"waitFor": 3000

# Total request timeout in ms (default: 30000, max waitFor = half of timeout)
"timeout": 60000

# Use fast mode — skips JS rendering for static pages (faster but may miss dynamic content)
"fastMode": true
```

#### Proxy Options

```bash
# Proxy mode: "basic" (default), "stealth", "enhanced", "auto"
"proxy": "stealth"

# Block ad networks (default: true)
"blockAds": true
```

#### Browser Actions (interact with the page before scraping)

Perform up to 50 actions (total wait ≤ 60s including `waitFor`):

```bash
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com",
    "formats": ["markdown"],
    "actions": [
      {"type": "wait", "milliseconds": 2000},
      {"type": "click", "selector": "button.load-more"},
      {"type": "wait", "selector": ".new-content"},
      {"type": "scroll", "direction": "down"},
      {"type": "write", "text": "search query"},
      {"type": "press", "key": "Enter"},
      {"type": "executeJavascript", "script": "document.body.click()"},
      {"type": "screenshot"},
      {"type": "scrape"}
    ]
  }'
```

#### Location Spoofing (Geo-targeted content)

```bash
"location": {
  "country": "US",
  "languages": ["en-US", "en"]
}
```

#### Parsing Scrape Output

```bash
# Extract just the markdown
... | jq -r '.data.markdown'

# Extract metadata (title, status code, URL, language)
... | jq '.data.metadata | {title, statusCode, sourceURL, language}'

# Extract links
... | jq '.data.links'

# Check success
... | jq '.success'
```

#### LLM Extraction (requires `OPENAI_API_KEY` or `OLLAMA_BASE_URL` in `.env`)

```bash
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/product",
    "formats": ["markdown"],
    "jsonOptions": {
      "mode": "llm",
      "prompt": "Extract product details",
      "schema": {
        "type": "object",
        "properties": {
          "product_name": {"type": "string"},
          "price": {"type": "string"},
          "in_stock": {"type": "boolean"}
        }
      }
    }
  }'
```

### 2. Search the Web (search → scrape in one call)

Combines web search with Firecrawl scraping — returns results with full page content. Use when you want search + live content without the two-phase bx→Firecrawl workflow.

```bash
# Search only (returns title, URL, description — like Google results)
curl -s -X POST http://localhost:3002/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "Rust async best practices", "limit": 5}' | jq -r '.data[] | "\(.title)\n\(.url)"'

# Search + scrape (returns full page content for each result)
curl -s -X POST http://localhost:3002/v1/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "Rust async best practices",
    "limit": 3,
    "scrapeOptions": {"formats": ["markdown"]}
  }' | jq -r '.data[] | "== \(.metadata.title) ==\n\(.markdown[:500])"'

# Search with language/country targeting
curl -s -X POST http://localhost:3002/v1/search \
  -H 'Content-Type: application/json' \
  -d '{"query": "cafe near me", "lang": "fr", "country": "FR"}'

# Search + scrape with JS rendering
# (useful when search result pages need JavaScript)
curl -s -X POST http://localhost:3002/v1/search \
  -H 'Content-Type: application/json' \
  -d '{
    "query": "pricing comparison",
    "limit": 2,
    "scrapeOptions": {
      "formats": ["markdown"],
      "waitFor": 2000
    }
  }'
```

Search options: `query`, `limit` (default: 5, max: 100), `lang` (default: "en"), `country`, `location`, `tbs` (Google time filter, e.g. "qdr:d" for last day), `filter` (e.g. "u1" for past hour).

**bx vs Firecrawl search** — both do generic web search. Prefer `bx` when result quality matters (Brave index > DuckDuckGo), you need freshness filtering, or you want to triage pre-extracted snippets before scraping. Prefer Firecrawl search when you want search + live content in one call and don't need bx-specific features (Goggles, news, images, places).

### 3. Map a Site (find URLs without downloading content)

Fast way to discover all URLs on a domain — uses sitemap + light crawling.

```bash
# Map all URLs on a domain
curl -s -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com"}'

# Filter by search term
curl -s -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "search": "pricing", "limit": 50}'

# Include subdomains
curl -s -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "includeSubdomains": true}'

# Only use sitemap (no crawling)
curl -s -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com", "sitemapOnly": true}'
```

Map options: `includePaths`, `excludePaths`, `maxDepth`, `limit` (default: 5000, max: 5000), `ignoreSitemap`, `includeSubdomains`.

### 4. Crawl a Site (download content from multiple pages)

Async — submits a job, poll for results.

```bash
# Start a crawl
curl -s -X POST http://localhost:3002/v1/crawl \
  -H 'Content-Type: application/json' \
  -d '{
    "url": "https://example.com/blog",
    "limit": 20,
    "scrapeOptions": {"formats": ["markdown"]}
  }' | jq '.id'

# Check status (returns completed results)
curl -s http://localhost:3002/v1/crawl/JOB_ID | jq '{status: .status, total: (.data | length)}'

# Get just the markdown from completed results
curl -s http://localhost:3002/v1/crawl/JOB_ID | jq -r '.data[] | "\(.metadata.title)\n\(.markdown[:200])"'
```

Crawl options (`crawlerOptions`):

| Option | Default | What it does |
|--|--|--|
| `includePaths` | `[]` | Only crawl URLs matching these regex patterns |
| `excludePaths` | `[]` | Skip URLs matching these regex patterns |
| `maxDepth` | 10 | Max URL path depth to crawl |
| `limit` | 10000 | Max pages to crawl |
| `allowExternalLinks` | false | Follow links to external domains |
| `allowSubdomains` | false | Follow links to subdomains |
| `ignoreRobotsTxt` | false | Respect robots.txt rules |
| `ignoreSitemap` | false | Use sitemap for URL discovery |
| `delay` | none | Seconds between requests (max 60) |
| `deduplicateSimilarURLs` | true | Skip URLs that differ only in query params |

### 5. Batch Scrape (queue multiple URLs)

Like crawl, but you provide the URL list instead of discovery by link-following.

```bash
# Submit batch scrape
curl -s -X POST http://localhost:3002/v1/batch/scrape \
  -H 'Content-Type: application/json' \
  -d '{
    "urls": ["https://example.com/1", "https://example.com/2"],
    "formats": ["markdown"]
  }' | jq '.id'

# Check status
curl -s http://localhost:3002/v1/batch/scrape/JOB_ID | jq '{status: .status, total: (.data | length)}'
```

Batch accepts all scrape options (`formats`, `waitFor`, `actions`, etc.) plus `urls` array.

## Search → Scrape Patterns

### Pattern 1: Search, then read top results

```bash
# 1. Search for URLs
bx "Rust async best practices" --count 5 | jq -r '.web.results[:3][] | .url'

# 2. Scrape each URL with Firecrawl
for url in $(bx "Rust async best practices" --count 5 | jq -r '.web.results[:3][] | .url'); do
  echo "=== $url ==="
  curl -s -X POST http://localhost:3002/v1/scrape \
    -H 'Content-Type: application/json' \
    -d "{\"url\": \"$url\", \"formats\": [\"markdown\"]}" | jq -r '.data.markdown' | head -30
done
```

### Pattern 2: Direct scrape (known site)

Skip search entirely when you know the URL:

```bash
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://www.example.com/product-page.html", "formats": ["markdown"]}'
```

### Pattern 3: Quick check if bx snippets are enough

```bash
# 1. Try bx context first (fast, no extra tool)
bx "Rust async book channels" --max-urls 3 --max-tokens 2048
# 2. If snippets are stale/empty/JS-heavy → Firecrawl
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "URL_FROM_BX"}'
```

### Pattern 4: Discover site structure, then scrape specific pages

```bash
# 1. Map the site to find relevant pages
curl -s -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://docs.example.com", "search": "authentication", "limit": 10}' | jq -r '.links[]'

# 2. Scrape the most relevant page
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "URL_FROM_MAP", "formats": ["markdown"]}' | jq -r '.data.markdown'
```

## Troubleshooting

| Problem | Solution |
|---|---|
| `bx` returns no results for a site | Site is JS-rendered, blocked, or unindexed. Use Firecrawl directly on the known URL, or map the parent domain. |
| `bx` snippets are outdated | Use Firecrawl to scrape the URL live. |
| `bx` results are too broad | Narrow with `--include-site`, search operators, `--threshold strict`, or Goggles boosts/blocks. |
| `bx` returns 401/403 | Brave Search credentials are unavailable or invalid. Prefer Firecrawl search if discovery can be DuckDuckGo-backed; otherwise ask the user before changing credentials. |
| Firecrawl returns 403 | Site has bot protection. Try `"proxy": "stealth"`, `"waitFor": 2000`, or a browser action. Self-hosted lacks advanced proxy rotation. |
| Firecrawl returns 404 | URL is dead or the search index is stale. Map the parent domain to find valid links. |
| Firecrawl returns empty markdown | Page requires login, has a paywall, or renders content dynamically. Check `statusCode`; try `"waitFor"`, scrolling/click actions, or `"formats": ["html"]`. |
| Firecrawl scrape is slow | JS-heavy pages can take 3–10s. Use `"fastMode": true` for static pages when rendering is unnecessary. |
| Content is missing after scrape | Add `"waitFor": 2000`, use browser `"actions"`, or request `"html"`/`"rawHtml"` to inspect the page. |
| Too much noise in output | Use `"onlyMainContent": true`, `"onlyCleanContent": true`, `"includeTags"`, or `"excludeTags"`. |
| Mobile-only content | Add `"mobile": true`. |
| Links are needed | Use `"formats": ["links"]`; v2 does not use `includeLinks`. |

## Examples

**User:** *"what's on https://example.com/pricing?"*
```bash
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://example.com/pricing", "formats": ["markdown"]}' | jq -r '.data.markdown'
```

**User:** *"find me the latest Next.js 15 breaking changes"*
```bash
bx "Next.js 15 breaking changes migration guide" --max-urls 5 --max-tokens 4096
# If snippets are stale, scrape the top result:
curl -s -X POST http://localhost:3002/v1/scrape \
  -H 'Content-Type: application/json' \
  -d '{"url": "URL_FROM_BX", "formats": ["markdown"]}'
```

**User:** *"what pages does docs.example.com have about authentication?"*
```bash
curl -s -X POST http://localhost:3002/v1/map \
  -H 'Content-Type: application/json' \
  -d '{"url": "https://docs.example.com", "search": "authentication"}' | jq -r '.links[]'
```

**User:** *"check the latest Python 3.14 release news"*
```bash
bx news "Python 3.14 release" --freshness pd
```
