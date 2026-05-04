#!/usr/bin/env python3
"""Create a concise, local digest of Pi session JSONL files for retrospectives."""

from __future__ import annotations

import argparse
import json
import os
import re
import sys
from collections import Counter, defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

TOKEN_PATTERNS = [
    re.compile(r"\b(sk-[A-Za-z0-9_-]{16,})\b"),
    re.compile(r"\b(gh[pousr]_[A-Za-z0-9_]{16,})\b"),
    re.compile(r"\b(hf_[A-Za-z0-9]{16,})\b"),
]
SECRET_ASSIGNMENT = re.compile(
    r"(?i)\b(api[_-]?key|token|secret|password|authorization|bearer)\b\s*[:=]\s*['\"]?([^\s'\"]{8,})"
)
ERROR_PATTERNS = [
    ("command-not-found", re.compile(r"command not found|not recognized as an internal|no such command", re.I)),
    ("missing-file", re.compile(r"no such file or directory|cannot find|not found", re.I)),
    ("permission", re.compile(r"permission denied|operation not permitted|eacces", re.I)),
    ("timeout", re.compile(r"timed? out|timeout", re.I)),
    ("network", re.compile(r"network (error|unreachable|failure)|dns|eai_again|enotfound|could not resolve|connection (refused|reset|timed out)", re.I)),
    ("rate-limit", re.compile(r"rate limit|too many requests|\b429\b", re.I)),
    ("edit-match", re.compile(r"oldText|exact text|unique, non-overlapping|must match|replacement failed", re.I)),
    ("test-failure", re.compile(r"(^|\\n|\\b)(failures?|failed|error|traceback|exception|panic)(\\b|:)", re.I)),
]
LARGE_ARG_KEYS = {"content", "oldText", "newText", "thinking", "data"}


def default_agent_dir() -> Path:
    override = os.environ.get("PI_CODING_AGENT_DIR")
    return Path(os.path.expanduser(override)) if override else Path.home() / ".pi" / "agent"


def default_session_dir() -> Path:
    override = os.environ.get("PI_CODING_AGENT_SESSION_DIR")
    return Path(os.path.expanduser(override)) if override else default_agent_dir() / "sessions"


def redact(text: str) -> str:
    for pattern in TOKEN_PATTERNS:
        text = pattern.sub("<redacted-token>", text)
    text = SECRET_ASSIGNMENT.sub(lambda m: f"{m.group(1)}=<redacted>", text)
    return text


def compact_ws(text: str) -> str:
    return re.sub(r"\s+", " ", text.replace("\r\n", "\n")).strip()


def snippet(value: Any, chars: int = 240) -> str:
    if value is None:
        return ""
    if not isinstance(value, str):
        try:
            value = json.dumps(value, ensure_ascii=False, sort_keys=True)
        except TypeError:
            value = str(value)
    value = compact_ws(redact(value))
    if len(value) <= chars:
        return value
    return value[: max(0, chars - 1)] + "…"


def parse_time(value: Any) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return datetime.fromtimestamp(value / 1000, tz=timezone.utc)
        except Exception:
            return None
    if isinstance(value, str):
        try:
            return datetime.fromisoformat(value.replace("Z", "+00:00"))
        except ValueError:
            return None
    return None


def fmt_time(value: Any) -> str:
    dt = parse_time(value)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%SZ") if dt else "unknown-time"


def norm_cwd(value: str | None) -> str | None:
    if not value:
        return None
    return os.path.normcase(os.path.abspath(os.path.expanduser(value)))


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    entries: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as f:
        for line_no, line in enumerate(f, 1):
            line = line.strip()
            if not line:
                continue
            try:
                entry = json.loads(line)
            except json.JSONDecodeError as exc:
                entries.append({"type": "parse_error", "line": line_no, "error": str(exc), "timestamp": None})
                continue
            entries.append(entry)
    return entries


def content_to_text(content: Any, include_thinking: bool = False) -> str:
    if isinstance(content, str):
        return content
    if not isinstance(content, list):
        return "" if content is None else str(content)

    parts: list[str] = []
    for block in content:
        if not isinstance(block, dict):
            parts.append(str(block))
            continue
        block_type = block.get("type")
        if block_type == "text":
            parts.append(block.get("text", ""))
        elif block_type == "thinking":
            if include_thinking:
                parts.append(block.get("thinking", ""))
            else:
                thinking_len = len(block.get("thinking", "") or "")
                parts.append(f"[thinking omitted, {thinking_len} chars]")
        elif block_type == "image":
            parts.append(f"[image {block.get('mimeType', 'unknown')}]")
        elif block_type == "toolCall":
            name = block.get("name", "tool")
            call_id = block.get("id", "unknown")
            parts.append(f"[toolCall {name} {call_id}]")
    return "\n".join(part for part in parts if part)


def iter_tool_calls(content: Any) -> list[dict[str, Any]]:
    if not isinstance(content, list):
        return []
    return [block for block in content if isinstance(block, dict) and block.get("type") == "toolCall"]


def summarize_args(name: str, args: Any, chars: int) -> str:
    if not isinstance(args, dict):
        return snippet(args, chars)

    if name in {"read", "write"}:
        summary = {"path": args.get("path")}
        if name == "read":
            if args.get("offset") is not None:
                summary["offset"] = args.get("offset")
            if args.get("limit") is not None:
                summary["limit"] = args.get("limit")
        else:
            summary["content_chars"] = len(str(args.get("content", "")))
        return snippet(summary, chars)

    if name == "edit":
        edits = args.get("edits")
        summary = {"path": args.get("path"), "edits": len(edits) if isinstance(edits, list) else None}
        return snippet(summary, chars)

    if name == "bash":
        summary = {"command": args.get("command")}
        if args.get("timeout") is not None:
            summary["timeout"] = args.get("timeout")
        return snippet(summary, chars)

    compact: dict[str, Any] = {}
    for key, value in args.items():
        if key in LARGE_ARG_KEYS:
            compact[key] = f"<{len(str(value))} chars>"
        elif isinstance(value, list) and len(value) > 5:
            compact[key] = f"<{len(value)} items>"
        else:
            compact[key] = value
    return snippet(compact, chars)


def normalize_arg_key(args: Any) -> str:
    def norm(value: Any) -> Any:
        if isinstance(value, dict):
            out: dict[str, Any] = {}
            for key, item in value.items():
                if key in LARGE_ARG_KEYS:
                    out[key] = f"<chars:{len(str(item))}>"
                elif key == "edits" and isinstance(item, list):
                    out[key] = [
                        {
                            "oldText": f"<chars:{len(str(edit.get('oldText', '')))}>",
                            "newText": f"<chars:{len(str(edit.get('newText', '')))}>",
                        }
                        if isinstance(edit, dict)
                        else "<edit>"
                        for edit in item
                    ]
                else:
                    out[key] = norm(item)
            return out
        if isinstance(value, list):
            return [norm(item) for item in value]
        return value

    try:
        return json.dumps(norm(args), sort_keys=True, ensure_ascii=False)
    except TypeError:
        return str(args)


def recursive_has_truncated(value: Any) -> bool:
    if isinstance(value, dict):
        for key, item in value.items():
            if str(key).lower() == "truncated" and bool(item):
                return True
            if recursive_has_truncated(item):
                return True
    elif isinstance(value, list):
        return any(recursive_has_truncated(item) for item in value)
    elif isinstance(value, str):
        return "truncated" in value.lower()
    return False


def session_meta(path: Path) -> dict[str, Any]:
    entries = read_jsonl(path)
    header = entries[0] if entries and entries[0].get("type") == "session" else {}
    first_user = ""
    name = ""
    last_ts = None
    message_count = 0
    for entry in entries:
        last_ts = entry.get("timestamp") or last_ts
        if entry.get("type") == "session_info" and entry.get("name"):
            name = str(entry.get("name"))
        message = entry.get("message") if entry.get("type") == "message" else None
        if isinstance(message, dict):
            message_count += 1
            if not first_user and message.get("role") == "user":
                first_user = content_to_text(message.get("content"))
    ts = header.get("timestamp") or last_ts
    dt = parse_time(ts) or datetime.fromtimestamp(path.stat().st_mtime, tz=timezone.utc)
    return {
        "path": path,
        "id": header.get("id", ""),
        "timestamp": dt,
        "cwd": header.get("cwd", ""),
        "name": name,
        "first_user": first_user,
        "messages": message_count,
    }


def discover_sessions(session_dir: Path, cwd_filter: str | None = None) -> list[dict[str, Any]]:
    if not session_dir.exists():
        return []
    wanted_cwd = norm_cwd(cwd_filter)
    sessions: list[dict[str, Any]] = []
    for path in session_dir.rglob("*.jsonl"):
        try:
            meta = session_meta(path)
        except Exception as exc:
            print(f"warning: could not read {path}: {exc}", file=sys.stderr)
            continue
        if wanted_cwd and norm_cwd(meta.get("cwd")) != wanted_cwd:
            continue
        sessions.append(meta)
    sessions.sort(key=lambda item: item["timestamp"], reverse=True)
    return sessions


def resolve_target(args: argparse.Namespace) -> Path | None:
    session_dir = Path(args.session_dir).expanduser()
    cwd = args.cwd if args.cwd else None
    target = args.target

    if target and target not in {"latest", "previous"}:
        candidate = Path(os.path.expanduser(target))
        if candidate.exists():
            return candidate

    sessions = discover_sessions(session_dir, cwd)
    if target == "latest" or args.latest:
        if not sessions:
            raise SystemExit(f"No sessions found under {session_dir}")
        return sessions[0]["path"]
    if target == "previous" or args.previous:
        if len(sessions) < 2:
            raise SystemExit(f"Need at least two matching sessions under {session_dir}; found {len(sessions)}")
        return sessions[1]["path"]

    if target:
        needle = target.lower()
        matches = [
            meta
            for meta in sessions or discover_sessions(session_dir, None)
            if str(meta.get("id", "")).lower().startswith(needle)
            or needle in meta["path"].name.lower()
            or needle in str(meta["path"]).lower()
        ]
        if len(matches) == 1:
            return matches[0]["path"]
        if len(matches) > 1:
            print("Multiple sessions matched:", file=sys.stderr)
            print_session_list(matches[:20], limit=20, out=sys.stderr)
            raise SystemExit(2)
        raise SystemExit(f"No session matched target {target!r}")

    return None


def print_session_list(sessions: list[dict[str, Any]], limit: int, out: Any = sys.stdout) -> None:
    if not sessions:
        print("No matching Pi sessions found.", file=out)
        return
    print("Recent Pi sessions:", file=out)
    for index, meta in enumerate(sessions[:limit]):
        label = meta.get("name") or snippet(meta.get("first_user", ""), 80) or "(no title)"
        sid = str(meta.get("id") or "")[:8]
        print(
            f"{index:2d}. {meta['timestamp'].strftime('%Y-%m-%d %H:%M:%SZ')} "
            f"{sid:8s} messages={meta.get('messages', 0):3d} "
            f"cwd={meta.get('cwd') or '?'}\n"
            f"    {label}\n"
            f"    {meta['path']}",
            file=out,
        )


def active_branch(entries: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_id = {entry.get("id"): entry for entry in entries if entry.get("id")}
    leaf = next((entry for entry in reversed(entries) if entry.get("id")), None)
    branch: list[dict[str, Any]] = []
    seen: set[str] = set()
    while leaf and leaf.get("id") not in seen:
        branch.append(leaf)
        seen.add(leaf.get("id"))
        parent_id = leaf.get("parentId")
        leaf = by_id.get(parent_id)
    branch.reverse()
    return branch


def child_counts(entries: list[dict[str, Any]]) -> Counter[str]:
    counts: Counter[str] = Counter()
    for entry in entries:
        parent = entry.get("parentId")
        if parent:
            counts[parent] += 1
    return counts


def detect_patterns(text: str) -> list[str]:
    return [name for name, pattern in ERROR_PATTERNS if pattern.search(text)]


def analyze(path: Path, content_chars: int) -> dict[str, Any]:
    raw_entries = read_jsonl(path)
    header = raw_entries[0] if raw_entries and raw_entries[0].get("type") == "session" else {}
    entries = [entry for entry in raw_entries if entry.get("type") != "session"]
    branch = active_branch(entries)

    entry_types = Counter(entry.get("type", "unknown") for entry in entries)
    branch_types = Counter(entry.get("type", "unknown") for entry in branch)
    role_counts: Counter[str] = Counter()
    models: Counter[str] = Counter()
    stop_reasons: Counter[str] = Counter()
    usage = Counter()
    total_cost = 0.0
    tool_calls: list[dict[str, Any]] = []
    tool_by_id: dict[str, dict[str, Any]] = {}
    tool_results: list[dict[str, Any]] = []
    bash_execs: list[dict[str, Any]] = []
    compactions: list[dict[str, Any]] = []
    timeline: list[dict[str, str]] = []

    for entry in branch:
        entry_id = entry.get("id", "")
        entry_type = entry.get("type", "unknown")
        timestamp = entry.get("timestamp")
        message = entry.get("message") if entry_type == "message" else None
        line = {"id": str(entry_id), "time": fmt_time(timestamp), "kind": entry_type, "text": ""}

        if isinstance(message, dict):
            role = message.get("role", "unknown")
            role_counts[role] += 1
            if role == "user":
                line["kind"] = "user"
                line["text"] = snippet(content_to_text(message.get("content")), content_chars)
            elif role == "assistant":
                provider = message.get("provider") or message.get("api") or "?"
                model = message.get("model") or "?"
                models[f"{provider}/{model}"] += 1
                stop = message.get("stopReason") or "?"
                stop_reasons[stop] += 1
                msg_usage = message.get("usage") or {}
                if isinstance(msg_usage, dict):
                    for key in ["input", "output", "cacheRead", "cacheWrite", "totalTokens"]:
                        if isinstance(msg_usage.get(key), (int, float)):
                            usage[key] += msg_usage[key]
                    cost = msg_usage.get("cost")
                    if isinstance(cost, dict) and isinstance(cost.get("total"), (int, float)):
                        total_cost += float(cost["total"])
                calls = iter_tool_calls(message.get("content"))
                call_names = []
                for call in calls:
                    rec = {
                        "entryId": entry_id,
                        "timestamp": timestamp,
                        "id": call.get("id"),
                        "name": call.get("name", "unknown"),
                        "arguments": call.get("arguments"),
                        "argsSummary": summarize_args(call.get("name", "unknown"), call.get("arguments"), content_chars),
                    }
                    tool_calls.append(rec)
                    if rec["id"]:
                        tool_by_id[str(rec["id"])] = rec
                    call_names.append(rec["name"])
                text = content_to_text(message.get("content"))
                line["kind"] = "assistant"
                line["text"] = (
                    f"stop={stop} model={provider}/{model} "
                    f"tools={','.join(call_names) if call_names else '-'} text={snippet(text, content_chars)}"
                )
            elif role == "toolResult":
                call_id = str(message.get("toolCallId", ""))
                call = tool_by_id.get(call_id, {})
                tool_name = message.get("toolName") or call.get("name") or "unknown"
                text = content_to_text(message.get("content"))
                is_error = bool(message.get("isError"))
                details = message.get("details")
                patterns = detect_patterns(text) if (is_error or tool_name in {"bash", "grep", "find", "ls"}) else []
                result = {
                    "entryId": entry_id,
                    "timestamp": timestamp,
                    "toolCallId": call_id,
                    "toolName": tool_name,
                    "isError": is_error,
                    "text": text,
                    "details": details,
                    "patterns": patterns,
                    "truncated": recursive_has_truncated(details) or "truncated" in text.lower(),
                }
                tool_results.append(result)
                line["kind"] = "toolResult"
                status = "ERROR" if is_error else "ok"
                extras = []
                if result["patterns"]:
                    extras.append("patterns=" + ",".join(result["patterns"]))
                if result["truncated"]:
                    extras.append("truncated")
                line["text"] = f"{tool_name} {status} {' '.join(extras)} {snippet(text, content_chars)}"
            elif role == "bashExecution":
                bash_execs.append({"entryId": entry_id, "timestamp": timestamp, **message})
                line["kind"] = "bashExecution"
                flags = []
                if message.get("cancelled"):
                    flags.append("cancelled")
                if message.get("truncated"):
                    flags.append("truncated")
                line["text"] = (
                    f"exit={message.get('exitCode')} {' '.join(flags)} "
                    f"cmd={snippet(message.get('command'), content_chars)} output={snippet(message.get('output'), content_chars)}"
                )
            else:
                line["kind"] = str(role)
                line["text"] = snippet(content_to_text(message.get("content")), content_chars)
        elif entry_type == "compaction":
            compactions.append(entry)
            line["text"] = f"tokensBefore={entry.get('tokensBefore')} firstKept={entry.get('firstKeptEntryId')} {snippet(entry.get('summary'), content_chars)}"
        elif entry_type == "branch_summary":
            line["text"] = f"from={entry.get('fromId')} {snippet(entry.get('summary'), content_chars)}"
        elif entry_type == "custom_message":
            line["kind"] = f"custom_message:{entry.get('customType', '?')}"
            line["text"] = snippet(content_to_text(entry.get("content")), content_chars)
        elif entry_type == "model_change":
            line["text"] = f"model={entry.get('provider')}/{entry.get('modelId')}"
        elif entry_type == "thinking_level_change":
            line["text"] = f"thinkingLevel={entry.get('thinkingLevel')}"
        elif entry_type == "session_info":
            line["text"] = f"name={entry.get('name')}"
        elif entry_type == "label":
            line["text"] = f"target={entry.get('targetId')} label={entry.get('label')}"
        else:
            line["text"] = snippet(entry, content_chars)
        timeline.append(line)

    tool_counts = Counter(call["name"] for call in tool_calls)
    tool_error_counts = Counter(result["toolName"] for result in tool_results if result["isError"] or result["patterns"])
    repeated_call_keys: defaultdict[str, list[dict[str, Any]]] = defaultdict(list)
    for call in tool_calls:
        repeated_call_keys[f"{call['name']} {normalize_arg_key(call.get('arguments'))}"].append(call)
    repeated_calls = [(key, calls) for key, calls in repeated_call_keys.items() if len(calls) > 1]
    repeated_calls.sort(key=lambda item: len(item[1]), reverse=True)

    command_counts: Counter[str] = Counter()
    for call in tool_calls:
        if call["name"] == "bash" and isinstance(call.get("arguments"), dict):
            cmd = call["arguments"].get("command")
            if cmd:
                command_counts[str(cmd)] += 1
    for execution in bash_execs:
        cmd = execution.get("command")
        if cmd:
            command_counts[str(cmd)] += 1

    signals: list[dict[str, str]] = []
    for result in tool_results:
        if result["isError"] or result["patterns"] or result["truncated"]:
            bits = []
            if result["isError"]:
                bits.append("isError")
            if result["patterns"]:
                bits.extend(result["patterns"])
            if result["truncated"]:
                bits.append("truncated")
            signals.append(
                {
                    "entryId": str(result["entryId"]),
                    "time": fmt_time(result["timestamp"]),
                    "category": ",".join(bits),
                    "text": f"{result['toolName']}: {snippet(result['text'], content_chars)}",
                }
            )
    for execution in bash_execs:
        exit_code = execution.get("exitCode")
        output = execution.get("output") or ""
        patterns = detect_patterns(output)
        if execution.get("cancelled") or execution.get("truncated") or (exit_code not in (0, None)) or patterns:
            bits = []
            if exit_code not in (0, None):
                bits.append(f"exit={exit_code}")
            if execution.get("cancelled"):
                bits.append("cancelled")
            if execution.get("truncated"):
                bits.append("truncated")
            bits.extend(patterns)
            signals.append(
                {
                    "entryId": str(execution.get("entryId")),
                    "time": fmt_time(execution.get("timestamp")),
                    "category": ",".join(bits),
                    "text": f"! {snippet(execution.get('command'), content_chars)} -> {snippet(output, content_chars)}",
                }
            )

    branch_points = [entry_id for entry_id, count in child_counts(entries).items() if count > 1]

    return {
        "path": path,
        "header": header,
        "entries": entries,
        "branch": branch,
        "entryTypes": entry_types,
        "branchTypes": branch_types,
        "roleCounts": role_counts,
        "models": models,
        "stopReasons": stop_reasons,
        "usage": usage,
        "totalCost": total_cost,
        "toolCalls": tool_calls,
        "toolCounts": tool_counts,
        "toolResults": tool_results,
        "toolErrorCounts": tool_error_counts,
        "bashExecs": bash_execs,
        "compactions": compactions,
        "timeline": timeline,
        "signals": signals,
        "repeatedCalls": repeated_calls,
        "commandCounts": command_counts,
        "branchPoints": branch_points,
    }


def limited_timeline(timeline: list[dict[str, str]], max_events: int, full: bool) -> list[dict[str, str]]:
    if full or len(timeline) <= max_events:
        return timeline
    if max_events < 10:
        return timeline[-max_events:]
    head_count = max(3, max_events // 4)
    tail_count = max_events - head_count - 1
    omitted = len(timeline) - head_count - tail_count
    return timeline[:head_count] + [{"id": "...", "time": "...", "kind": "omitted", "text": f"{omitted} events omitted"}] + timeline[-tail_count:]


def print_markdown(report: dict[str, Any], args: argparse.Namespace) -> None:
    header = report["header"]
    print("# Pi Session Digest")
    print()
    print("## Target")
    print(f"- File: `{report['path']}`")
    print(f"- Session ID: `{header.get('id', '?')}`")
    print(f"- CWD: `{header.get('cwd', '?')}`")
    print(f"- Started: {fmt_time(header.get('timestamp'))}")
    if header.get("parentSession"):
        print(f"- Parent session: `{header.get('parentSession')}`")
    print()

    print("## Metrics")
    print(f"- Entries: {len(report['entries'])} total, {len(report['branch'])} on active branch")
    print(f"- Branch points: {len(report['branchPoints'])}")
    print("- Entry types: " + (", ".join(f"{k}={v}" for k, v in report["entryTypes"].most_common()) or "none"))
    print("- Message roles on active branch: " + (", ".join(f"{k}={v}" for k, v in report["roleCounts"].most_common()) or "none"))
    print("- Models: " + (", ".join(f"{k}={v}" for k, v in report["models"].most_common()) or "none"))
    print("- Stop reasons: " + (", ".join(f"{k}={v}" for k, v in report["stopReasons"].most_common()) or "none"))
    if report["usage"]:
        usage = report["usage"]
        print(
            f"- Usage: input={int(usage.get('input', 0))}, output={int(usage.get('output', 0))}, "
            f"cacheRead={int(usage.get('cacheRead', 0))}, cacheWrite={int(usage.get('cacheWrite', 0))}, "
            f"totalTokens={int(usage.get('totalTokens', 0))}, cost=${report['totalCost']:.4f}"
        )
    print("- Tool calls: " + (", ".join(f"{k}={v}" for k, v in report["toolCounts"].most_common()) or "none"))
    print("- Tool error/pattern counts: " + (", ".join(f"{k}={v}" for k, v in report["toolErrorCounts"].most_common()) or "none"))
    if report["compactions"]:
        print(f"- Compactions on active branch: {len(report['compactions'])}")
    print()

    print("## Error / Friction Signals")
    if report["signals"]:
        for signal in report["signals"][: args.max_signals]:
            print(f"- `{signal['entryId']}` {signal['time']} **{signal['category']}** — {signal['text']}")
        if len(report["signals"]) > args.max_signals:
            print(f"- ... {len(report['signals']) - args.max_signals} more signals omitted")
    else:
        print("- No obvious tool-error, truncation, timeout, or command-failure signals detected by heuristics.")
    print()

    print("## Repetition Signals")
    repeated_commands = [(cmd, count) for cmd, count in report["commandCounts"].most_common() if count > 1]
    if report["repeatedCalls"] or repeated_commands:
        for key, calls in report["repeatedCalls"][:10]:
            first = calls[0]
            print(f"- Tool call repeated {len(calls)}x from `{first['entryId']}`: `{snippet(key, args.content_chars)}`")
        for cmd, count in repeated_commands[:10]:
            print(f"- Bash command repeated {count}x: `{snippet(cmd, args.content_chars)}`")
    else:
        print("- No exact repeated tool-call or bash-command signals detected.")
    print()

    print("## Tool Calls")
    if report["toolCalls"]:
        for call in report["toolCalls"][: args.max_tool_calls]:
            print(f"- `{call['entryId']}` {fmt_time(call['timestamp'])} `{call['name']}` {call['argsSummary']}")
        if len(report["toolCalls"]) > args.max_tool_calls:
            print(f"- ... {len(report['toolCalls']) - args.max_tool_calls} more tool calls omitted")
    else:
        print("- No tool calls on active branch.")
    print()

    print("## Active Branch Timeline")
    for item in limited_timeline(report["timeline"], args.max_events, args.full):
        print(f"- `{item['id']}` {item['time']} **{item['kind']}** — {item['text']}")
    print()

    print("## Retrospective Questions for the Agent")
    print("- Which failures were caused by missing tools versus poor use of available tools?")
    print("- Which repeated discovery steps belong in AGENTS.md, a skill, docs, or an extension?")
    print("- Did the agent read the right instructions/manifests before editing?")
    print("- Did the user correct the agent or restate intent? If so, what instruction would prevent that?")
    print("- Was verification appropriate, skipped, too slow, or blocked by environment setup?")
    print("- Are recommendations general enough to help future sessions, or are they one-off overfitting?")


def parse_args(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("target", nargs="?", help="Session JSONL path, partial session id, 'latest', or 'previous'.")
    parser.add_argument("--session-dir", default=str(default_session_dir()), help="Pi session directory. Defaults to PI_CODING_AGENT_SESSION_DIR or ~/.pi/agent/sessions.")
    parser.add_argument("--cwd", default=None, help="Only list/resolve sessions whose header cwd matches this path.")
    parser.add_argument("--list", action="store_true", help="List recent matching sessions and exit.")
    parser.add_argument("--latest", action="store_true", help="Analyze the newest matching session.")
    parser.add_argument("--previous", action="store_true", help="Analyze the second-newest matching session; useful from inside a new retrospective session.")
    parser.add_argument("--limit", type=int, default=20, help="Number of sessions to show with --list.")
    parser.add_argument("--markdown", action="store_true", help="Emit Markdown (default; kept for readability in skill instructions).")
    parser.add_argument("--full", action="store_true", help="Show the full active-branch timeline.")
    parser.add_argument("--max-events", type=int, default=160, help="Max timeline events unless --full is set.")
    parser.add_argument("--max-signals", type=int, default=50, help="Max error/friction signals to print.")
    parser.add_argument("--max-tool-calls", type=int, default=80, help="Max tool calls to print.")
    parser.add_argument("--content-chars", type=int, default=260, help="Max characters for snippets.")
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    args = parse_args(argv)
    session_dir = Path(args.session_dir).expanduser()

    if args.list:
        print_session_list(discover_sessions(session_dir, args.cwd), args.limit)
        return 0

    target = resolve_target(args)
    if not target:
        print("No target session specified. Recent sessions:", file=sys.stderr)
        print_session_list(discover_sessions(session_dir, args.cwd), args.limit, out=sys.stderr)
        print("\nPass a path/id, --latest, or --previous.", file=sys.stderr)
        return 2

    report = analyze(target, args.content_chars)
    print_markdown(report, args)
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv[1:]))
