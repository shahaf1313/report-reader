// Markdown -> sanitised DOM fragment. Needs the marked and DOMPurify globals
// from vendor/. Kept apart from main.js so tests/lib.test.html can exercise it.
import { textDir } from './lib.js';

const BIDI_BLOCKS = 'p, li, h2, h3, h4, h5, h6, blockquote, td, th, dd, dt';

export function renderMarkdown(md) {
  const html = window.marked.parse(String(md ?? ''), { gfm: true, breaks: false });
  const clean = window.DOMPurify.sanitize(html, { USE_PROFILES: { html: true } });
  const tpl = document.createElement('template');
  tpl.innerHTML = clean;
  const root = tpl.content;

  // The page already has one h1; demote any in the body.
  root.querySelectorAll('h1').forEach((el) => {
    const h2 = document.createElement('h2');
    h2.append(...el.childNodes);
    el.replaceWith(h2);
  });

  // Any Hebrew makes a block RTL, even when it opens with an English name;
  // only a block with no Hebrew at all is laid out LTR (still right-aligned by CSS).
  root.querySelectorAll(BIDI_BLOCKS).forEach((el) => el.setAttribute('dir', textDir(el.textContent)));

  root.querySelectorAll('a[href]').forEach((a) => {
    if (/^https?:/i.test(a.getAttribute('href'))) {
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
    }
  });

  // Wide tables scroll sideways instead of stretching the page.
  root.querySelectorAll('table').forEach((t) => {
    const wrap = document.createElement('div');
    wrap.className = 'table-wrap';
    t.replaceWith(wrap);
    wrap.append(t);
  });

  root.querySelectorAll('img').forEach((img) => {
    img.loading = 'lazy';
    img.decoding = 'async';
  });
  return root;
}
