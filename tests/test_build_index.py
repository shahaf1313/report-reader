"""Edge-case tests for scripts/build_index.py.  Run: python -m unittest discover tests"""
from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "scripts"))
import build_index as bi  # noqa: E402

GOOD = """---
title: שבוע טוב לשווקים
date: 2026-09-25
summary: סיכום קצר
mood: 1
tags: [ריבית, "מט\\"ח"]
markets:
  - name: ת"א 35
    value: "2,961"
    change: "+1.8%"
outlook:
  - תחזית אחת
---

## פתיחה

טקסט הדוח.
"""


class Tmp(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.dir = Path(self._tmp.name) / "reports"
        self.dir.mkdir()

    def tearDown(self):
        self._tmp.cleanup()

    def write(self, name: str, text: str | bytes):
        p = self.dir / name
        if isinstance(text, bytes):
            p.write_bytes(text)
        else:
            p.write_text(text, encoding="utf-8", newline="")
        return p

    def build(self):
        return bi.build_index(self.dir)


class TestHappyPath(Tmp):
    def test_full_report(self):
        self.write("2026-09-25.md", GOOD)
        index, warnings = self.build()
        self.assertEqual(warnings, [])
        [r] = index["reports"]
        self.assertEqual(r["id"], "2026-09-25")
        self.assertEqual(r["file"], "reports/2026-09-25.md")
        self.assertEqual(r["title"], "שבוע טוב לשווקים")
        self.assertEqual(r["mood"], 1)
        self.assertEqual(r["tags"], ["ריבית", 'מט"ח'])
        self.assertEqual(r["markets"], [{"name": 'ת"א 35', "value": "2,961", "change": "+1.8%"}])
        self.assertEqual(r["outlook"], ["תחזית אחת"])
        self.assertGreater(r["words"], 0)

    def test_sorted_newest_first_across_years(self):
        for d in ["2025-12-26", "2026-01-02", "2026-09-18"]:
            self.write(f"{d}.md", f"# דוח {d}\n\nטקסט")
        ids = [r["id"] for r in self.build()[0]["reports"]]
        self.assertEqual(ids, ["2026-09-18", "2026-01-02", "2025-12-26"])

    def test_two_reports_same_day_with_suffix(self):
        self.write("2026-09-25.md", "# בוקר\n\nא")
        self.write("2026-09-25-special.md", "# מהדורה מיוחדת\n\nב")
        index, warnings = self.build()
        self.assertEqual(warnings, [])
        self.assertEqual({r["id"] for r in index["reports"]}, {"2026-09-25", "2026-09-25-special"})
        self.assertEqual({r["date"] for r in index["reports"]}, {"2026-09-25"})

    def test_empty_folder(self):
        index, warnings = self.build()
        self.assertEqual(index["count"], 0)
        self.assertEqual(index["reports"], [])
        self.assertEqual(warnings, [])


class TestFallbacks(Tmp):
    def test_no_front_matter_uses_h1_and_filename_date(self):
        self.write("2026-09-25.md", "# כותרת מהגוף\n\nטקסט")
        [r] = self.build()[0]["reports"]
        self.assertEqual(r["title"], "כותרת מהגוף")
        self.assertEqual(r["date"], "2026-09-25")
        self.assertIsNone(r["mood"])
        self.assertEqual(r["tags"], [])

    def test_no_title_anywhere(self):
        self.write("2026-09-25.md", "רק טקסט בלי כותרת")
        [r] = self.build()[0]["reports"]
        self.assertIn("2026-09-25", r["title"])

    def test_bom_and_crlf(self):
        text = "﻿" + GOOD.replace("\n", "\r\n")
        self.write("2026-09-25.md", text.encode("utf-8"))
        index, warnings = self.build()
        self.assertEqual(warnings, [])
        self.assertEqual(index["reports"][0]["title"], "שבוע טוב לשווקים")

    def test_front_matter_date_overrides_filename(self):
        self.write("2026-09-25.md", "---\ndate: 2026-09-26\ntitle: x\n---\nטקסט")
        self.assertEqual(self.build()[0]["reports"][0]["date"], "2026-09-26")

    def test_date_as_quoted_string(self):
        self.write("2026-09-25.md", "---\ndate: '2026-09-25'\ntitle: x\n---\nטקסט")
        self.assertEqual(self.build()[0]["reports"][0]["date"], "2026-09-25")

    def test_mood_is_clamped_and_rounded(self):
        self.write("2026-09-18.md", "---\nmood: 7\n---\nא")
        self.write("2026-09-25.md", "---\nmood: '-1.6'\n---\nא")
        moods = {r["id"]: r["mood"] for r in self.build()[0]["reports"]}
        self.assertEqual(moods, {"2026-09-18": 2, "2026-09-25": -2})

    def test_single_tag_as_string(self):
        self.write("2026-09-25.md", "---\ntags: ריבית\n---\nא")
        self.assertEqual(self.build()[0]["reports"][0]["tags"], ["ריבית"])

    def test_numeric_market_values_become_strings(self):
        self.write("2026-09-25.md", "---\nmarkets:\n  - name: נפט\n    value: 71.4\n    change: -2.3\n---\nא")
        [m] = self.build()[0]["reports"][0]["markets"]
        self.assertEqual(m, {"name": "נפט", "value": "71.4", "change": "-2.3"})

    def test_long_fields_are_truncated_and_whitespace_collapsed(self):
        self.write("2026-09-25.md", f"---\ntitle: \"{'א ' * 500}\"\nsummary: \"a\\n\\n  b\"\n---\nא")
        r = self.build()[0]["reports"][0]
        self.assertLessEqual(len(r["title"]), 200)
        self.assertEqual(r["summary"], "a b")

    def test_summary_only_report_is_allowed(self):
        self.write("2026-09-25.md", "---\ntitle: x\nsummary: רק סיכום\n---\n")
        index, warnings = self.build()
        self.assertEqual((index["count"], warnings), (1, []))


class TestRejected(Tmp):
    def assertSkipped(self, name, text, fragment):
        self.write(name, text)
        index, warnings = self.build()
        self.assertEqual(index["count"], 0, warnings)
        self.assertEqual(len(warnings), 1)
        self.assertIn(fragment, warnings[0])

    def test_bad_filename(self):
        self.assertSkipped("weekly.md", "# x", "file name")

    def test_impossible_date_in_filename(self):
        self.assertSkipped("2026-02-30.md", "# x", "invalid date")

    def test_impossible_date_in_front_matter(self):
        self.assertSkipped("2026-09-25.md", "---\ndate: 2026-13-01\n---\nא", "invalid date")

    def test_broken_yaml(self):
        self.assertSkipped("2026-09-25.md", "---\ntitle: [unclosed\n---\nא", "YAML")

    def test_front_matter_not_a_mapping(self):
        self.assertSkipped("2026-09-25.md", "---\n- a\n- b\n---\nא", "mapping")

    def test_empty_file(self):
        self.assertSkipped("2026-09-25.md", "", "empty")

    def test_front_matter_only_without_summary(self):
        self.assertSkipped("2026-09-25.md", "---\ntitle: x\n---\n   \n", "empty")

    def test_mood_not_a_number(self):
        self.assertSkipped("2026-09-25.md", "---\nmood: bullish\n---\nא", "mood")

    def test_mood_boolean(self):
        self.assertSkipped("2026-09-25.md", "---\nmood: true\n---\nא", "mood")

    def test_market_without_name(self):
        self.assertSkipped("2026-09-25.md", "---\nmarkets:\n  - value: 3\n---\nא", "name")

    def test_not_utf8(self):
        self.assertSkipped("2026-09-25.md", "# כותרת".encode("cp1255"), "UTF-8")

    def test_one_bad_report_does_not_hide_the_rest(self):
        self.write("2026-09-18.md", GOOD)
        self.write("2026-09-25.md", "---\ntitle: [oops\n---\nא")
        index, warnings = self.build()
        self.assertEqual([r["id"] for r in index["reports"]], ["2026-09-18"])
        self.assertEqual(len(warnings), 1)


class TestIgnoredFiles(Tmp):
    def test_readme_drafts_and_non_markdown_are_ignored(self):
        self.write("README.md", "# about")
        self.write("_draft-2026-09-25.md", "# draft")
        self.write("notes.txt", "x")
        self.write("index.json", "{}")
        index, warnings = self.build()
        self.assertEqual((index["count"], warnings), (0, []))


class TestCli(Tmp):
    def test_writes_utf8_json_and_strict_exit_code(self):
        self.write("2026-09-25.md", GOOD)
        self.assertEqual(bi.main(["--reports", str(self.dir), "--strict"]), 0)
        data = json.loads((self.dir / "index.json").read_text(encoding="utf-8"))
        self.assertEqual(data["reports"][0]["title"], "שבוע טוב לשווקים")
        self.assertIn("generated", data)

        self.write("2026-09-18.md", "---\nmood: nope\n---\nא")
        self.assertEqual(bi.main(["--reports", str(self.dir)]), 0)
        self.assertEqual(bi.main(["--reports", str(self.dir), "--strict"]), 1)

    def test_missing_folder(self):
        self.assertEqual(bi.main(["--reports", str(self.dir / "nope")]), 2)


if __name__ == "__main__":
    unittest.main()
