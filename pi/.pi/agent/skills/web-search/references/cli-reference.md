# bx — Brave Search CLI Reference

Official CLI docs: <https://github.com/brave/brave-search-cli/blob/main/README.md>

> **Requires**: [Brave Search API Key](https://api.search.brave.com) + `bx` binary
> **Install**: `curl -fsSL https://raw.githubusercontent.com/brave/brave-search-cli/main/scripts/install.sh | sh`
> **Configure**: `bx config set-key` (interactive) or `export BRAVE_SEARCH_API_KEY=YOUR_KEY`

## All Commands (Full List)

| Command | Description | Output path |
|--|--|--|
| `context` | RAG/LLM grounding — pre-extracted web content | `.grounding.generic[]` → `{url, title, snippets[]}` |
| `web` | Web search — all result types/operators/filters | `.web.results[]`, `.news.results[]`, etc. |
| `news` | News articles with freshness filters | `.results[]` → `{title, url, age}` |
| `images` | Image search (up to 200 results) | `.results[]` → `{title, url, thumbnail.src}` |
| `videos` | Video search with duration/views | `.results[]` → `{title, url, video.duration}` |
| `places` | Local place/POI search (200M+ POIs) | `.results[]` → `{title, postal_address, contact}` |
| `pois` | POI details by ID | Use IDs from `places` |
| `descriptions` | AI-generated POI descriptions by ID | `.results[].description` |
| `suggest` | Autocomplete suggestions | — |
| `spellcheck` | Correct misspelled queries | — |
| `config` | Manage API key and settings | `set-key`, `show-key`, `path`, `show` |

## Token Budget Control

| Flag | Default | What it does |
|--|--|--|
| `--count` | 20 | Results to consider before extracting (1-50) |
| `--max-tokens` | 8192 | Total tokens to return (1024-32768) |
| `--max-tokens-per-url` | 4096 | Max per URL (512-8192) |
| `--max-urls` | 20 | Max URLs in response (1-50) |
| `--max-snippets` | 50 | Max snippets across all URLs |
| `--threshold` | balanced | Relevance: `strict`, `balanced`, `lenient` |

## Goggles DSL — Full Reference

Separate rules with newlines. Full docs: [goggles-quickstart](https://github.com/brave/goggles-quickstart).

| Rule | Effect | Example |
|--|--|--|
| `$boost=N,site=DOMAIN` | Promote domain (N=1-10) | `$boost=3,site=docs.rs` |
| `$downrank=N,site=DOMAIN` | Demote domain (N=1-10) | `$downrank=5,site=example.com` |
| `$discard,site=DOMAIN` | Remove domain entirely | `$discard,site=example.com` |
| `/path/$boost=N` | Boost matching URL paths | `/docs/$boost=5` |
| `*pattern*$boost=N` | Wildcard URL matching | `*api*$boost=3` |
| Generic `$discard` | Allowlist mode — discard unmatched | `$discard` (as last rule) |

Piping rules via stdin:
```bash
echo '$boost=5,site=docs.rs
$boost=5,site=crates.io
$boost=3,site=github.com' | bx "axum middleware" --goggles @- --max-tokens 4096
```

Use `@/path/to/file` to reuse a goggle across queries. Hosted raw `.goggle` URLs are also supported.

## `bx` Exit Codes

| Code | Meaning | Action |
|--|--|--|
| 0 | Success | Process results |
| 1 | Client error | Fix query/parameters |
| 2 | Usage error | Fix CLI arguments |
| 3 | Auth error (401/403) | Check API key |
| 4 | Rate limited (429) | Retry after delay |
| 5 | Server/network error | Retry with backoff |

## Notes

- **Config precedence**: CLI flag > env var > config file > default. Prefer `bx config set-key` over `--api-key` (flags show in process listings).
- **Global flags**: `--config PATH`, `--api-key KEY`, `--base-url URL`, `--timeout SECS` (default 30), `--extra KEY=VALUE`, `--endpoint PATH`.
- **Local proxy**: `--base-url` may point to loopback HTTP; non-loopback `http://` rejected.
- **Location**: `context`/`web` support `--lat`, `--long`, `--city`, `--state`, `--loc-country`, `--postal-code`; `places` uses `--location`.
- **Query equals command name**: use `bx -- web` or `bx context "web"`.
- **Help**: `bx --help`; `bx <command> --help`.

---

# Firecrawl API Reference (v2.11, self-hosted)

Full docs: <https://docs.firecrawl.dev>

Self-hosted search engine priority: Fire Engine (cloud-only) > SearXNG (if configured) > DuckDuckGo (fallback).

## Search Request Options

| Option | Type | Default | Description |
|--|--|--|--|
| `query` | `string` | *(required)* | Search query |
| `limit` | `int` | 5 | Max results (max: 100) |
| `lang` | `string` | `"en"` | Language code |
| `country` | `string` | `"us"` | Country code |
| `location` | `string` | — | Location string |
| `tbs` | `string` | — | Google time filter (e.g. `"qdr:d"` for last day, `"qdr:w"` for last week) |
| `filter` | `string` | — | Search filter (e.g. `"u1"` for past hour) |
| `timeout` | `int` | 60000 | Request timeout in ms |
| `scrapeOptions` | `object` | `{}` | Full scrape options (formats, waitFor, actions, etc.) — scrapes each result |

Self-hosted at `http://localhost:3002` (v2.11). Full docs: <https://docs.firecrawl.dev>

## Scrape Request Options (complete list)

| Option | Type | Default | Description |
|--|--|--|--|
| `formats` | `string[]` | `["markdown"]` | Output formats: `markdown`, `html`, `rawHtml`, `links`, `screenshot`, `screenshot@fullPage`, `extract` |
| `headers` | `object` | — | Custom HTTP headers to send |
| `includeTags` | `string[]` | — | Only include content from these HTML tags |
| `excludeTags` | `string[]` | — | Exclude these HTML tags |
| `onlyMainContent` | `bool` | `true` | Strip nav, footer, sidebar — keep only main content |
| `onlyCleanContent` | `bool` | `false` | Aggressive cleanup (ads, navbars, modals) |
| `waitFor` | `int` | `0` | Wait ms after page load (max 60000, must be ≤ timeout/2) |
| `timeout` | `int` | `30000` | Request timeout in ms |
| `mobile` | `bool` | `false` | Render mobile layout |
| `parsePDF` | `bool` | `true` | Parse embedded PDFs |
| `blockAds` | `bool` | `true` | Block ad networks |
| `skipTlsVerification` | `bool` | — | Skip TLS cert validation |
| `removeBase64Images` | `bool` | `true` | Strip base64-encoded images from output |
| `fastMode` | `bool` | `false` | Skip JS rendering (faster, may miss dynamic content) |
| `proxy` | `string` | `"basic"` | Proxy mode: `basic`, `stealth`, `enhanced`, `auto` |
| `maxAge` | `int` | `86400000` | Max cache age in ms (1 day) |
| `storeInCache` | `bool` | `true` | Cache the result |
| `location` | `object` | — | `{country: "US", languages: ["en"]}` — ISO 3166-1 alpha-2 |
| `actions` | `array` | — | Browser actions (see below) |
| `jsonOptions` | `object` | — | LLM extraction: `{mode: "llm", schema: {...}, prompt: "..."}` |

## Actions Reference

Max 50 actions. Total wait (`waitFor` + all wait actions) ≤ 60 seconds.

| Action | Fields | Description |
|--|--|--|
| `wait` | `milliseconds?: int` or `selector?: string` | Wait for time or element |
| `click` | `selector: string`, `all?: bool` | Click element(s) |
| `write` | `text: string` | Type text into focused element |
| `press` | `key: string` | Press a key (e.g. `"Enter"`, `"Tab"`) |
| `scroll` | `direction?: "up"\|"down"`, `selector?: string` | Scroll page or element |
| `scrape` | — | Capture content at this point (useful mid-sequence) |
| `screenshot` | `fullPage?: bool`, `quality?: 1-100` | Take screenshot |
| `executeJavascript` | `script: string` | Run arbitrary JS |
| `pdf` | `landscape?: bool`, `scale?: number`, `format?: "A4"\|"Letter"\|...` | Generate PDF |

## Crawl Options

| Option | Default | Description |
|--|--|--|
| `includePaths` | `[]` | Regex patterns — only crawl matching URLs |
| `excludePaths` | `[]` | Regex patterns — skip matching URLs |
| `maxDepth` | 10 | Max URL path depth |
| `maxDiscoveryDepth` | — | Max depth for link discovery (separate from crawling) |
| `limit` | 10000 | Max pages to crawl |
| `allowBackwardLinks` | false | Follow links to parent paths (deprecated, use `crawlEntireDomain`) |
| `crawlEntireDomain` | — | Crawl the entire domain regardless of path depth |
| `allowExternalLinks` | false | Follow links to external domains |
| `allowSubdomains` | false | Follow links to subdomains |
| `ignoreRobotsTxt` | false | Ignore robots.txt rules |
| `ignoreSitemap` | false | Don't use sitemap for URL discovery |
| `deduplicateSimilarURLs` | true | Skip URLs differing only in query params |
| `ignoreQueryParameters` | false | Strip query params before deduplication |
| `regexOnFullURL` | false | Apply path regex against the full URL |
| `delay` | none | Seconds between requests (max 60) |

## Map Options

| Option | Default | Description |
|--|--|--|
| `search` | — | Filter results by search term |
| `includeSubdomains` | true | Include subdomains in results |
| `sitemapOnly` | false | Only use sitemap (no crawling) |
| `limit` | 5000 | Max URLs to return (max: 5000) |
| `useIndex` | true | Use pre-built index |
| `filterByPath` | true | Filter results by path patterns |
| `ignoreCache` | false | Bypass index cache |

## Scrape Response Structure

```json
{
  "success": true,
  "data": {
    "markdown": "...",
    "html": "...",
    "links": ["https://...", "..."],
    "metadata": {
      "title": "Page Title",
      "statusCode": 200,
      "sourceURL": "https://...",
      "url": "https://...",
      "contentType": "text/html",
      "language": "en",
      "viewport": "width=device-width",
      "favicon": "data:...",
      "proxyUsed": "basic",
      "creditsUsed": 1,
      "concurrencyLimited": false,
      "scrapeId": "uuid"
    }
  }
}
```
