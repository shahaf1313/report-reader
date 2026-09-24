import * as L from './lib.js';
import { renderMarkdown } from './render.js';

const INDEX_URL = 'reports/index.json';
const main = document.getElementById('main');

const state = {
  reports: null,       // array from index.json, newest first
  loadError: null,
  query: '',
  homeScroll: 0,
  indexStamp: null,
};

// ---------- storage (may be unavailable in private mode) ----------
const store = {
  get(key, fallback) {
    try {
      const v = localStorage.getItem(key);
      return v === null ? fallback : JSON.parse(v);
    } catch { return fallback; }
  },
  set(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* ignore */ }
  },
};

// ---------- tiny DOM helper ----------
function h(tag, attrs, ...children) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === null || v === undefined || v === false) continue;
    if (k === 'class') el.className = v;
    else if (k === 'html') el.innerHTML = v;
    else if (k.startsWith('on')) el.addEventListener(k.slice(2), v);
    else el.setAttribute(k, v === true ? '' : v);
  }
  for (const c of children.flat(Infinity)) {
    if (c === null || c === undefined || c === false) continue;
    el.append(c instanceof Node ? c : document.createTextNode(String(c)));
  }
  // dir="auto" is resolved here rather than by the browser; see L.textDir.
  if (attrs?.dir === 'auto') el.dir = L.textDir(el.textContent);
  return el;
}

const ICONS = {
  back: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M9 5l7 7-7 7" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  share: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3v12M8 7l4-4 4 4M6 11H5v10h14V11h-1" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  text: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 19l5-13 5 13M5 14h6M15 19l3.5-9 3.5 9M16.2 16h4.6" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>',
  search: '<svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="6.5" fill="none" stroke="currentColor" stroke-width="1.8"/><path d="M16 16l4.5 4.5" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/></svg>',
};

// ---------- data ----------
function normalizeIndex(data) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.reports) ? data.reports : null;
  if (!list) throw new Error('bad-index');
  return list
    .filter((r) => r && typeof r.id === 'string' && typeof r.file === 'string')
    .map((r) => ({
      ...r,
      title: String(r.title || r.id),
      summary: r.summary ? String(r.summary) : '',
      tags: Array.isArray(r.tags) ? r.tags.map(String) : [],
      markets: Array.isArray(r.markets) ? r.markets.filter((m) => m && m.name) : [],
      outlook: Array.isArray(r.outlook) ? r.outlook.map(String).filter(Boolean) : [],
      mood: L.clampMood(r.mood),
    }))
    .sort((a, b) => (b.date || '').localeCompare(a.date || '') || b.id.localeCompare(a.id));
}

async function loadIndex() {
  try {
    const res = await fetch(INDEX_URL, { cache: 'no-cache' });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json();
    const stamp = data?.generated || JSON.stringify(data).length;
    const changed = stamp !== state.indexStamp;
    state.reports = normalizeIndex(data);
    state.indexStamp = stamp;
    state.loadError = null;
    return changed;
  } catch (err) {
    console.warn('[reader] index load failed', err);
    if (!state.reports) state.loadError = err;
    return false;
  }
}

const reportCache = new Map();
async function loadReportBody(report) {
  if (reportCache.has(report.id)) return reportCache.get(report.id);
  const res = await fetch(report.file, { cache: 'no-cache' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const text = await res.text();
  reportCache.set(report.id, text);
  return text;
}

// ---------- read state ----------
const readSet = new Set(store.get('read', []));
function markRead(id) {
  if (readSet.has(id)) return;
  readSet.add(id);
  store.set('read', [...readSet].slice(-400));
}
// On first launch, don't flag the whole back catalogue as unread.
function seedReadState() {
  if (store.get('seeded', false) || !state.reports?.length) return;
  state.reports.slice(1).forEach((r) => readSet.add(r.id));
  store.set('read', [...readSet]);
  store.set('seeded', true);
}

// ---------- shared pieces ----------
function marketTiles(markets, limit) {
  const list = limit ? markets.slice(0, limit) : markets;
  if (!list.length) return null;
  return h('ul', { class: 'markets', 'aria-label': 'נתוני שוק' },
    list.map((m) => {
      const dir = L.changeDirection(m.change);
      const dirLabel = { up: 'עלייה', down: 'ירידה', flat: 'ללא שינוי' }[dir];
      return h('li', { class: `market ${dir}` },
        h('span', { class: 'm-name', dir: 'auto' }, m.name),
        m.value ? h('bdi', { class: 'm-value', dir: 'ltr' }, String(m.value)) : null,
        m.change ? h('bdi', { class: 'm-change', dir: 'ltr', 'aria-label': `${dirLabel} ${m.change}` }, String(m.change)) : null,
      );
    }),
  );
}

function metaLine(r) {
  const week = L.isoWeek(r.date);
  const mins = L.readingMinutes(r.words);
  const parts = [];
  if (week) parts.push(h('span', { class: 'week' }, `שבוע ${week}`));
  if (r.date) parts.push(h('time', { datetime: r.date }, L.formatDate(r.date)));
  if (mins) parts.push(h('span', null, `${mins} דק׳ קריאה`));
  return h('p', { class: 'meta' }, parts);
}

function moodChart(reports) {
  const W = 320, H = 72;
  const pts = L.moodPoints(reports, W, H);
  if (!pts) return null;
  const path = pts.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(' ');
  const zeroY = 6 + (H - 12) / 2;
  const latest = pts[0];
  const svg = `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" role="img" aria-label="מצב הרוח בשווקים ב־${pts.length} השבועות האחרונים. השבוע: ${L.MOOD_LABELS[latest.mood]}">
      <line x1="0" x2="${W}" y1="${zeroY}" y2="${zeroY}" class="zero"/>
      <path d="${path}" class="line" vector-effect="non-scaling-stroke"/>
    </svg>`;
  const dots = pts.map((p, i) => h('span', {
    class: `dot${i === 0 ? ' latest' : ''}`,
    style: `left:${((p.x / W) * 100).toFixed(2)}%;top:${((p.y / H) * 100).toFixed(2)}%`,
    title: `${L.formatDate(p.date)}: ${L.MOOD_LABELS[p.mood]}`,
  }));
  return h('section', { class: 'mood', 'aria-labelledby': 'mood-h' },
    h('div', { class: 'mood-head' },
      h('h2', { id: 'mood-h' }, 'מצב הרוח בשווקים'),
      h('p', { class: `mood-now m${latest.mood}` }, `השבוע: ${L.MOOD_LABELS[latest.mood]}`),
    ),
    h('div', { class: 'mood-plot' },
      h('span', { class: 'axis top', 'aria-hidden': 'true' }, 'אופטימי'),
      h('span', { class: 'axis bottom', 'aria-hidden': 'true' }, 'פסימי'),
      h('div', { class: 'mood-svg', html: svg }, dots),
    ),
    h('p', { class: 'mood-foot' }, `${pts.length} שבועות אחרונים, מהחדש לישן`),
  );
}

// ---------- views ----------
function viewLoading() {
  main.replaceChildren(h('div', { class: 'loading', 'aria-label': 'טוען' }));
}

function viewMessage(title, body, action) {
  main.replaceChildren(
    h('section', { class: 'message' },
      h('h1', null, title),
      h('p', null, body),
      action || null,
    ),
  );
}

function viewHome() {
  document.title = 'הדוח השבועי';
  const reports = state.reports || [];

  const masthead = h('header', { class: 'masthead' },
    h('h1', { class: 'brand' }, 'הדוח השבועי'),
    h('p', { class: 'tagline' }, 'כלכלה ושוק ההון, בכל יום שישי בבוקר'),
  );

  if (!reports.length) {
    main.replaceChildren(masthead, h('section', { class: 'empty' },
      h('h2', null, 'עדיין אין דוחות'),
      h('p', null, 'הדוח הראשון יופיע כאן ביום שישי בבוקר, אחרי הריצה השבועית.'),
    ));
    return;
  }

  const [latest] = reports;
  const unread = !readSet.has(latest.id);
  const hero = h('a', { class: 'hero', href: L.reportHref(latest.id) },
    h('p', { class: 'hero-kicker' }, unread ? 'חדש השבוע' : 'הדוח האחרון'),
    metaLine(latest),
    h('h2', { class: 'hero-title', dir: 'auto' }, latest.title),
    latest.summary ? h('p', { class: 'hero-summary', dir: 'auto' }, latest.summary) : null,
    marketTiles(latest.markets, 4),
    h('span', { class: 'hero-cta' }, 'לקריאת הדוח'),
  );

  const listEl = h('div', { class: 'archive-list' });
  const countEl = h('p', { class: 'archive-count', 'aria-live': 'polite' });
  const renderList = () => {
    const rest = state.query ? L.filterReports(reports, state.query) : reports.slice(1);
    countEl.textContent = state.query
      ? (rest.length ? `${rest.length} תוצאות` : '')
      : '';
    if (!rest.length) {
      listEl.replaceChildren(h('p', { class: 'no-results' },
        state.query ? `לא נמצא דוח שמתאים ל„${state.query.trim()}”. נסו מילה אחרת או תאריך.` : 'אין עדיין דוחות קודמים.'));
      return;
    }
    listEl.replaceChildren(...L.groupByMonth(rest).map((g) =>
      h('section', { class: 'month' },
        h('h3', { class: 'month-label' }, g.label),
        h('ol', { class: 'rows' }, g.items.map((r) =>
          h('li', null, h('a', { class: `row${readSet.has(r.id) ? '' : ' unread'}`, href: L.reportHref(r.id) },
            h('time', { class: 'row-date', datetime: r.date || '' }, L.formatDayMonth(r.date) || '—'),
            h('span', { class: 'row-main' },
              h('span', { class: 'row-title', dir: 'auto' }, r.title),
              r.summary ? h('span', { class: 'row-summary', dir: 'auto' }, r.summary) : null,
            ),
            r.mood !== null ? h('span', { class: `row-mood m${r.mood}`, title: L.MOOD_LABELS[r.mood], 'aria-label': `מצב רוח: ${L.MOOD_LABELS[r.mood]}` }) : null,
          )),
        )),
      ),
    ));
  };

  const search = h('label', { class: 'search' },
    h('span', { class: 'search-icon', html: ICONS.search }),
    h('span', { class: 'visually-hidden' }, 'חיפוש בארכיון'),
    h('input', {
      type: 'search',
      placeholder: 'חיפוש לפי נושא, מילה או תאריך',
      value: state.query,
      enterkeyhint: 'search',
      autocomplete: 'off',
      oninput: (e) => { state.query = e.target.value; renderList(); },
    }),
  );

  const archive = h('section', { class: 'archive', 'aria-labelledby': 'archive-h' },
    h('div', { class: 'archive-head' },
      h('h2', { id: 'archive-h' }, 'ארכיון'),
      countEl,
    ),
    reports.length > 1 ? search : null,
    listEl,
  );

  renderList();
  main.replaceChildren(masthead, hero, moodChart(reports), archive);
  requestAnimationFrame(() => window.scrollTo(0, state.homeScroll));
}

async function viewReport(id) {
  const reports = state.reports || [];
  const idx = reports.findIndex((r) => r.id === id);
  if (idx === -1) {
    viewMessage('הדוח לא נמצא', 'ייתכן שהקישור שגוי או שהדוח הוסר מהארכיון.',
      h('a', { class: 'button', href: '#/' }, 'חזרה לכל הדוחות'));
    return;
  }
  const r = reports[idx];
  const newer = reports[idx - 1];
  const older = reports[idx + 1];
  document.title = `${r.title} | הדוח השבועי`;

  const progress = h('div', { class: 'progress', 'aria-hidden': 'true' }, h('span'));
  const scaleBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'שינוי גודל טקסט', html: ICONS.text, onclick: cycleTextScale });
  const shareBtn = h('button', { class: 'icon-btn', type: 'button', 'aria-label': 'שיתוף', html: ICONS.share, onclick: () => shareReport(r) });
  const bar = h('header', { class: 'topbar' },
    h('a', { class: 'back', href: '#/', html: `${ICONS.back}<span>כל הדוחות</span>` }),
    h('div', { class: 'topbar-actions' }, scaleBtn, shareBtn),
    progress,
  );

  const body = h('div', { class: 'prose' }, h('div', { class: 'loading', 'aria-label': 'טוען את הדוח' }));
  const article = h('article', { class: 'report' },
    h('header', { class: 'report-head' },
      metaLine(r),
      h('h1', { class: 'report-title', tabindex: '-1', dir: 'auto' }, r.title),
      r.summary ? h('p', { class: 'lead', dir: 'auto' }, r.summary) : null,
    ),
    marketTiles(r.markets),
    body,
    r.outlook.length ? h('aside', { class: 'outlook', 'aria-labelledby': 'outlook-h' },
      h('h2', { id: 'outlook-h' }, 'מה צפוי בשבועות הקרובים'),
      h('ul', null, r.outlook.map((o) => h('li', { dir: 'auto' }, o))),
      h('p', { class: 'disclaimer' }, 'הערכה אוטומטית, לא ייעוץ השקעות.'),
    ) : null,
    r.tags.length ? h('ul', { class: 'tags', 'aria-label': 'נושאים' }, r.tags.map((t) => h('li', null, h('a', {
      href: '#/', dir: 'auto',
      onclick: () => { state.query = t; state.homeScroll = 0; },
    }, t)))) : null,
    h('nav', { class: 'pager', 'aria-label': 'דוחות סמוכים' },
      // RTL: the previous report sits on the right, like the previous page of a Hebrew book.
      older ? h('a', { class: 'pager-link older', href: L.reportHref(older.id) }, h('span', { class: 'pager-dir' }, 'הדוח הקודם'), h('span', { class: 'pager-title', dir: 'auto' }, older.title)) : null,
      newer ? h('a', { class: 'pager-link newer', href: L.reportHref(newer.id) }, h('span', { class: 'pager-dir' }, 'הדוח הבא'), h('span', { class: 'pager-title', dir: 'auto' }, newer.title)) : null,
    ),
  );

  main.replaceChildren(bar, article);
  window.scrollTo(0, 0);
  article.querySelector('.report-title').focus({ preventScroll: true });
  markRead(r.id);

  const load = async () => {
    try {
      const md = await loadReportBody(r);
      const content = L.stripLeadingTitle(L.stripFrontMatter(md), r.title);
      if (!content.trim()) {
        body.replaceChildren(h('p', { class: 'muted' }, 'לדוח הזה אין תוכן מעבר לסיכום.'));
      } else {
        body.replaceChildren(renderMarkdown(content));
      }
    } catch (err) {
      console.warn('[reader] report load failed', err);
      body.replaceChildren(h('div', { class: 'inline-error' },
        h('p', null, navigator.onLine ? 'טעינת הדוח נכשלה.' : 'הדוח הזה עוד לא נשמר במכשיר, ואין חיבור לרשת.'),
        h('button', { class: 'button', type: 'button', onclick: () => { body.replaceChildren(h('div', { class: 'loading' })); load(); } }, 'לנסות שוב'),
      ));
    }
  };
  load();
}

// ---------- actions ----------
const SCALES = [1, 1.12, 1.25, 0.92];
function applyTextScale() {
  document.documentElement.style.setProperty('--text-scale', SCALES[store.get('scale', 0)] ?? 1);
}
function cycleTextScale() {
  store.set('scale', (store.get('scale', 0) + 1) % SCALES.length);
  applyTextScale();
}

async function shareReport(r) {
  const url = new URL(L.reportHref(r.id), location.href).href;
  try {
    if (navigator.share) {
      await navigator.share({ title: r.title, text: r.summary || r.title, url });
      return;
    }
    await navigator.clipboard.writeText(url);
    flash('הקישור הועתק');
  } catch (err) {
    if (err?.name !== 'AbortError') flash('השיתוף נכשל');
  }
}

function flash(text) {
  const t = h('div', { class: 'toast', role: 'status' }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), 1800);
}

// ---------- router ----------
let currentView = null;
async function route() {
  const r = L.parseRoute(location.hash);
  if (currentView === 'home') state.homeScroll = window.scrollY;

  if (!state.reports && !state.loadError) {
    viewLoading();
    await loadIndex();
    seedReadState();
  }
  if (!state.reports) {
    currentView = 'error';
    viewMessage('לא הצלחנו לטעון את הדוחות',
      navigator.onLine ? 'קובץ הארכיון לא זמין כרגע.' : 'אין חיבור לרשת, ועדיין לא נשמרו דוחות במכשיר.',
      h('button', { class: 'button', type: 'button', onclick: () => { state.loadError = null; route(); } }, 'לנסות שוב'));
    return;
  }

  currentView = r.view;
  if (r.view === 'home') viewHome();
  else if (r.view === 'report') viewReport(r.id);
  else viewMessage('העמוד לא נמצא', 'הכתובת הזו לא מובילה לשום דוח.', h('a', { class: 'button', href: '#/' }, 'חזרה לכל הדוחות'));
}

// Reading progress for the report view.
let ticking = false;
window.addEventListener('scroll', () => {
  if (ticking) return;
  ticking = true;
  requestAnimationFrame(() => {
    ticking = false;
    const bar = document.querySelector('.progress span');
    if (!bar) return;
    const max = document.documentElement.scrollHeight - innerHeight;
    bar.style.transform = `scaleX(${max > 0 ? Math.min(1, scrollY / max) : 1})`;
  });
}, { passive: true });

// A new report may land while the app sits in the background.
document.addEventListener('visibilitychange', async () => {
  if (document.visibilityState !== 'visible') return;
  const changed = await loadIndex();
  if (changed && currentView === 'home') viewHome();
});

function updateOnline() {
  document.getElementById('offline').hidden = navigator.onLine;
}
window.addEventListener('online', updateOnline);
window.addEventListener('offline', updateOnline);

window.addEventListener('hashchange', route);
applyTextScale();
updateOnline();
route();

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch((err) => console.warn('[reader] sw registration failed', err));
}
