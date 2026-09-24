// Pure helpers with no DOM access, so they can be unit-tested in isolation
// (see tests/lib.test.html).

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const REPORT_ID = /^[0-9A-Za-z][0-9A-Za-z._-]{0,79}$/;

/**
 * Parse "YYYY-MM-DD" as a *local* calendar date. `new Date("2026-09-25")`
 * is UTC midnight, which shows as the previous day west of Greenwich.
 */
export function parseDate(str) {
  const m = ISO_DATE.exec(String(str ?? '').trim());
  if (!m) return null;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const date = new Date(y, mo - 1, d);
  if (date.getFullYear() !== y || date.getMonth() !== mo - 1 || date.getDate() !== d) return null;
  return date;
}

const fmtLong = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long', year: 'numeric' });
const fmtDayMonth = new Intl.DateTimeFormat('he-IL', { day: 'numeric', month: 'long' });
const fmtMonth = new Intl.DateTimeFormat('he-IL', { month: 'long', year: 'numeric' });

export function formatDate(str) {
  const d = parseDate(str);
  return d ? fmtLong.format(d) : '';
}

export function formatDayMonth(str) {
  const d = parseDate(str);
  return d ? fmtDayMonth.format(d) : '';
}

/** ISO-8601 week number. */
export function isoWeek(str) {
  const d = parseDate(str);
  if (!d) return null;
  const t = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = t.getUTCDay() || 7;
  t.setUTCDate(t.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(t.getUTCFullYear(), 0, 1));
  return Math.ceil(((t - yearStart) / 86400000 + 1) / 7);
}

/** Group reports (already sorted newest first) into [{key, label, items}] by month. */
export function groupByMonth(reports) {
  const groups = [];
  for (const r of reports) {
    const d = parseDate(r.date);
    const key = d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : 'undated';
    const label = d ? fmtMonth.format(d) : 'ללא תאריך';
    let g = groups[groups.length - 1];
    if (!g || g.key !== key) {
      g = { key, label, items: [] };
      groups.push(g);
    }
    g.items.push(r);
  }
  return groups;
}

/** Strip niqqud / punctuation differences so Hebrew search is forgiving. */
export function normalizeText(s) {
  return String(s ?? '')
    .normalize('NFKD')
    .replace(/[֑-ׇ]/g, '')
    .replace(/[̀-ͯ]/g, '')
    .replace(/["'״׳`]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

/** Every whitespace-separated term must appear in title, summary, tags or date. */
export function filterReports(reports, query) {
  const terms = normalizeText(query).split(' ').filter(Boolean);
  if (!terms.length) return reports;
  return reports.filter((r) => {
    const hay = normalizeText([r.title, r.summary, (r.tags || []).join(' '), r.date, formatDate(r.date)].join(' '));
    return terms.every((t) => hay.includes(t));
  });
}

/** "#/r/2026-09-25" -> {view:'report', id}; anything else -> home or notfound. */
export function parseRoute(hash) {
  let h = String(hash ?? '').replace(/^#/, '');
  if (h === '' || h === '/') return { view: 'home' };
  const m = /^\/r\/([^/?#]+)\/?$/.exec(h);
  if (m) {
    let id;
    try { id = decodeURIComponent(m[1]); } catch { return { view: 'notfound' }; }
    return REPORT_ID.test(id) ? { view: 'report', id } : { view: 'notfound' };
  }
  return { view: 'notfound' };
}

export function reportHref(id) {
  return `#/r/${encodeURIComponent(id)}`;
}

/** Remove a leading YAML front-matter block. Tolerates BOM and CRLF. */
export function stripFrontMatter(md) {
  const s = String(md ?? '').replace(/^﻿/, '');
  const m = /^---[ \t]*\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/.exec(s);
  return m ? s.slice(m[0].length) : s;
}

/** Drop a leading "# Title" line when it repeats the title we already render. */
export function stripLeadingTitle(md, title) {
  const m = /^\s*#[ \t]+(.+?)[ \t#]*(?:\r?\n|$)/.exec(md);
  if (m && normalizeText(m[1]) === normalizeText(title)) return md.slice(m[0].length);
  return md;
}

/** Classify a market change string such as "+1.2%", "−0.4%", "0.0%". */
export function changeDirection(change) {
  const s = String(change ?? '').trim().replace(/−/g, '-');
  const n = parseFloat(s.replace(/[^0-9.+-]/g, ''));
  if (!s || Number.isNaN(n) || n === 0) return 'flat';
  return n > 0 ? 'up' : 'down';
}

export function clampMood(v) {
  const n = Number(v);
  if (v === null || v === undefined || v === '' || !Number.isFinite(n)) return null;
  return Math.max(-2, Math.min(2, Math.round(n)));
}

export const MOOD_LABELS = {
  '-2': 'פסימי מאוד',
  '-1': 'פסימי',
  '0': 'ניטרלי',
  '1': 'אופטימי',
  '2': 'אופטימי מאוד',
};

/**
 * Points for the mood line, oldest on the right (RTL reading order puts
 * the newest week first, on the right edge). Returns null when there are
 * fewer than two weeks with a mood.
 */
export function moodPoints(reports, width, height, max = 26) {
  const rows = reports.filter((r) => clampMood(r.mood) !== null).slice(0, max);
  if (rows.length < 2) return null;
  const pad = 6;
  const step = (width - pad * 2) / (rows.length - 1);
  return rows.map((r, i) => ({
    id: r.id,
    date: r.date,
    mood: clampMood(r.mood),
    x: width - pad - i * step,
    y: pad + ((2 - clampMood(r.mood)) / 4) * (height - pad * 2),
  }));
}

/**
 * Base direction for a block of text. The browser's dir="auto" goes by the
 * first strong character, so "Nvidia דיווחה על..." would become an LTR line
 * pushed to the left. Here any Hebrew letter makes the block RTL; only text
 * with no Hebrew at all (an English quote, "+4.1%") is LTR.
 */
export function textDir(s) {
  const t = String(s ?? '');
  if (/[֐-׿]/.test(t)) return 'rtl';
  return t.trim() ? 'ltr' : 'rtl';
}

export function readingMinutes(words) {
  const n = Number(words);
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.max(1, Math.round(n / 200));
}
