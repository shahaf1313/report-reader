#!/usr/bin/env python3
"""Build reports/index.json from the Markdown reports in reports/.

Each report is a file named YYYY-MM-DD.md (optionally YYYY-MM-DD-suffix.md)
with an optional YAML front-matter block. See docs/report-format.md.

A malformed report is skipped with a warning instead of failing the whole
build, so one bad weekly run never takes the archive offline. Pass --strict
to turn warnings into a non-zero exit (used by the tests and CI check step).
"""
from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path

import yaml

FILENAME_RE = re.compile(r"^(\d{4}-\d{2}-\d{2})(?:-[0-9A-Za-z_-]{1,40})?\.md$")
H1_RE = re.compile(r"^\s*#[ \t]+(.+?)[ \t#]*$", re.MULTILINE)
FRONT_MATTER_RE = re.compile(r"^---[ \t]*\r?\n(.*?)\r?\n---[ \t]*(?:\r?\n|$)", re.DOTALL)
WORD_RE = re.compile(r"[\w֐-׿'\"״׳%.-]+", re.UNICODE)
MAX_TEXT = 400


class ReportError(ValueError):
    pass


class _Loader(yaml.SafeLoader):
    """SafeLoader that leaves dates as strings.

    PyYAML's own timestamp constructor raises a bare ValueError on
    "2026-13-01", which would crash the whole build; parse_date() reports
    it as a skipped report instead.
    """


_Loader.yaml_implicit_resolvers = {
    ch: [(tag, rx) for tag, rx in resolvers if tag != "tag:yaml.org,2002:timestamp"]
    for ch, resolvers in yaml.SafeLoader.yaml_implicit_resolvers.items()
}


def split_front_matter(text: str) -> tuple[dict, str]:
    text = text.lstrip("﻿")
    m = FRONT_MATTER_RE.match(text)
    if not m:
        return {}, text
    try:
        meta = yaml.load(m.group(1), Loader=_Loader) or {}  # noqa: S506 - _Loader is a SafeLoader
    except yaml.YAMLError as exc:
        raise ReportError(f"invalid YAML front matter: {exc}".splitlines()[0]) from exc
    if not isinstance(meta, dict):
        raise ReportError("front matter must be a mapping")
    return meta, text[m.end():]


def clean_str(value, limit: int = MAX_TEXT) -> str:
    if value is None:
        return ""
    s = " ".join(str(value).split())
    return s[:limit]


def parse_date(value, fallback: str) -> str:
    if value in (None, ""):
        value = fallback
    if isinstance(value, dt.datetime):
        value = value.date()
    if isinstance(value, dt.date):
        return value.isoformat()
    try:
        return dt.date.fromisoformat(str(value).strip()).isoformat()
    except ValueError as exc:
        raise ReportError(f"invalid date {value!r}") from exc


def parse_mood(value):
    if value is None or value == "":
        return None
    if isinstance(value, bool):
        raise ReportError("mood must be a number between -2 and 2")
    try:
        n = float(value)
    except (TypeError, ValueError) as exc:
        raise ReportError(f"mood must be a number between -2 and 2, got {value!r}") from exc
    if n != n:  # NaN
        raise ReportError("mood must be a number between -2 and 2")
    return max(-2, min(2, round(n)))


def parse_str_list(value, field: str, limit: int = 12) -> list[str]:
    if value is None:
        return []
    if isinstance(value, str):
        value = [value]
    if not isinstance(value, list):
        raise ReportError(f"{field} must be a list")
    return [s for s in (clean_str(v, 200) for v in value) if s][:limit]


def parse_markets(value) -> list[dict]:
    if value is None:
        return []
    if not isinstance(value, list):
        raise ReportError("markets must be a list")
    out = []
    for item in value:
        if not isinstance(item, dict) or not item.get("name"):
            raise ReportError(f"each market needs a name: {item!r}")
        out.append({
            "name": clean_str(item.get("name"), 40),
            "value": clean_str(item.get("value"), 24),
            "change": clean_str(item.get("change"), 16),
        })
    return out[:8]


def count_words(body: str) -> int:
    body = re.sub(r"```.*?```", " ", body, flags=re.DOTALL)
    body = re.sub(r"\[([^\]]*)\]\([^)]*\)", r"\1", body)
    return len(WORD_RE.findall(body))


def parse_report(path: Path) -> dict:
    m = FILENAME_RE.match(path.name)
    if not m:
        raise ReportError("file name must look like YYYY-MM-DD.md")
    try:
        text = path.read_text(encoding="utf-8")
    except UnicodeDecodeError as exc:
        raise ReportError("file is not valid UTF-8") from exc

    meta, body = split_front_matter(text)
    if not body.strip() and not meta.get("summary"):
        raise ReportError("report is empty")

    title = clean_str(meta.get("title"), 200)
    if not title:
        h1 = H1_RE.search(body)
        title = clean_str(h1.group(1), 200) if h1 else ""
    date = parse_date(meta.get("date"), m.group(1))
    if not title:
        title = f"הדוח השבועי {date}"

    return {
        "id": path.stem,
        # The site always serves the reports folder at /reports/, whatever
        # its name on disk (the preview server maps samples/ there).
        "file": f"reports/{path.name}",
        "date": date,
        "title": title,
        "summary": clean_str(meta.get("summary")),
        "mood": parse_mood(meta.get("mood")),
        "tags": parse_str_list(meta.get("tags"), "tags"),
        "markets": parse_markets(meta.get("markets")),
        "outlook": parse_str_list(meta.get("outlook"), "outlook", limit=6),
        "words": count_words(body),
    }


def build_index(reports_dir: Path) -> tuple[dict, list[str]]:
    reports, warnings = [], []
    for path in sorted(reports_dir.glob("*.md")):
        if path.name.lower() == "readme.md" or path.name.startswith(("_", ".")):
            continue
        try:
            reports.append(parse_report(path))
        except ReportError as exc:
            warnings.append(f"{path.name}: {exc}")
    reports.sort(key=lambda r: (r["date"], r["id"]), reverse=True)
    index = {
        "generated": dt.datetime.now(dt.timezone.utc).replace(microsecond=0).isoformat(),
        "count": len(reports),
        "reports": reports,
    }
    return index, warnings


def main(argv=None) -> int:
    root = Path(__file__).resolve().parent.parent
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--reports", type=Path, default=root / "reports")
    ap.add_argument("--out", type=Path, default=None, help="default: <reports>/index.json")
    ap.add_argument("--strict", action="store_true", help="exit 1 if any report was skipped")
    args = ap.parse_args(argv)

    if not args.reports.is_dir():
        print(f"error: {args.reports} is not a directory", file=sys.stderr)
        return 2
    index, warnings = build_index(args.reports)
    out = args.out or args.reports / "index.json"
    out.write_text(json.dumps(index, ensure_ascii=False, indent=1) + "\n", encoding="utf-8")

    for w in warnings:
        print(f"warning: skipped {w}", file=sys.stderr)
    print(f"wrote {out} with {index['count']} report(s)")
    return 1 if (warnings and args.strict) else 0


if __name__ == "__main__":
    sys.exit(main())
