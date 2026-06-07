# bx — Brave Search CLI Reference

Official CLI docs: <https://github.com/brave/brave-search-cli/blob/main/README.md>

> **Requires**: [Brave Search API Key](https://api.search.brave.com) + `bx` binary
> **Install**: `curl -fsSL https://raw.githubusercontent.com/brave/brave-search-cli/main/scripts/install.sh | sh`
> **Configure**: `bx config set-key` (interactive) or `export BRAVE_SEARCH_API_KEY=YOUR_KEY`

## All Commands

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
| `config` | Manage API key and settings | `set-key`, `show-key`, `path`, `show` |

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

## Notes

- **Config precedence**: CLI flag > env var > config file > default. Prefer `bx config set-key` over `--api-key` (flags show in process listings).
- **Global flags**: `--config PATH`, `--api-key KEY`, `--base-url URL`, `--timeout SECS` (default 30), `--extra KEY=VALUE`, `--endpoint PATH`.
- **Local proxy**: `--base-url` may point to loopback HTTP; non-loopback `http://` rejected.
- **Location**: `context`/`web` support `--lat`, `--long`, `--city`, `--state`, `--loc-country`, `--postal-code`; `places` uses `--location`.
- **Query equals command name**: use `bx -- web` or `bx context "web"`.
- **Help**: `bx --help`; `bx <command> --help`.
