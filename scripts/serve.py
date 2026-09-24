#!/usr/bin/env python3
"""Local preview server.

    python scripts/serve.py            # serve the real reports/ folder
    python scripts/serve.py --samples  # serve samples/ in place of reports/

Rebuilds the index before serving. Open http://localhost:8000
"""
from __future__ import annotations

import argparse
import functools
import http.server
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_index  # noqa: E402


class Handler(http.server.SimpleHTTPRequestHandler):
    reports_dir: Path = ROOT / "reports"

    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".webmanifest": "application/manifest+json",
        ".md": "text/markdown; charset=utf-8",
        ".js": "text/javascript; charset=utf-8",
        ".json": "application/json; charset=utf-8",
    }

    def translate_path(self, path):
        clean = path.split("?", 1)[0].split("#", 1)[0]
        if clean.startswith("/reports/"):
            name = clean[len("/reports/"):]
            target = (self.reports_dir / name).resolve()
            if self.reports_dir.resolve() in target.parents:
                return str(target)
            return str(self.reports_dir / "__nope__")
        return super().translate_path(path)

    def end_headers(self):
        self.send_header("Cache-Control", "no-cache")
        super().end_headers()


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--samples", action="store_true")
    ap.add_argument("--reports", type=Path)
    ap.add_argument("--port", type=int, default=8000)
    args = ap.parse_args()

    reports = args.reports or (ROOT / ("samples" if args.samples else "reports"))
    build_index.main(["--reports", str(reports)])
    Handler.reports_dir = reports
    handler = functools.partial(Handler, directory=str(ROOT))
    with http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler) as httpd:
        print(f"serving {ROOT} (reports from {reports}) at http://localhost:{args.port}")
        httpd.serve_forever()


if __name__ == "__main__":
    main()
