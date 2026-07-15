/* Input: pan, zoom, search, keyboard, and the gloss's delegated clicks. */

import { MAX_SCALE, MIN_SCALE } from './config.js';
import { E, P, events, people } from './model.js';
import { YEAR_MAX, YEAR_MIN, vis, view } from './layout.js';
import { position, applyTransform } from './position.js';
import { clampPanHere, deselect, hover, paint, refit, select } from './select.js';
import { glossEl, stage } from './scene.js';
import { yearOf } from './dates.js';

const INTERACTIVE = '.person-hit, .evt-dot, .evt-label, .corr-hit, .edge-hit';

// ── gloss: one delegated handler for every cross-reference button
glossEl.addEventListener('click', (ev) => {
  if (ev.target.closest('[data-close]')) { deselect(); return; }
  const b = ev.target.closest('button[data-kind]');
  if (b) select(b.dataset.kind, b.dataset.id);
});

// ── drag to pan
let drag = null;
stage.addEventListener('pointerdown', (ev) => {
  if (ev.target.closest(INTERACTIVE)) return;
  drag = { x: ev.clientX, y: ev.clientY, tx: view.tx, ty: view.ty, moved: false };
  stage.classList.add('dragging');
  stage.setPointerCapture(ev.pointerId);
});
stage.addEventListener('pointermove', (ev) => {
  if (!drag) return;
  view.tx = drag.tx + (ev.clientX - drag.x);
  view.ty = drag.ty + (ev.clientY - drag.y);
  if (Math.abs(ev.clientX - drag.x) + Math.abs(ev.clientY - drag.y) > 3) drag.moved = true;
  clampPanHere();
  applyTransform();   // pan is a pure translate, so no geometry recompute
});
stage.addEventListener('pointerup', (ev) => {
  const wasDrag = drag?.moved;
  drag = null;
  stage.classList.remove('dragging');
  // A click on empty vellum clears the selection; the end of a drag must not.
  if (!wasDrag && !ev.target.closest(INTERACTIVE)) deselect();
});
stage.addEventListener('pointercancel', () => {
  drag = null;
  stage.classList.remove('dragging');
});

// ── zoom
let raf = null;
export function zoomAt(factor, cy) {
  const before = (cy - view.ty) / view.scale;   // year under the cursor
  view.scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
  view.ty = cy - before * view.scale;           // keep that year under the cursor
  clampPanHere();
  if (raf) return;
  raf = requestAnimationFrame(() => { raf = null; position(); paint(); });
}

stage.addEventListener('wheel', (ev) => {
  ev.preventDefault();
  const r = stage.getBoundingClientRect();
  zoomAt(Math.pow(0.999, ev.deltaY), ev.clientY - r.top);
}, { passive: false });

// ── buttons
const btn = (id) => document.getElementById(id);

btn('zoom-in').addEventListener('click', () => zoomAt(1.35, stage.clientHeight / 2));
btn('zoom-out').addEventListener('click', () => zoomAt(1 / 1.35, stage.clientHeight / 2));
btn('reset').addEventListener('click', () => { deselect(); fit(); });

const kinBtn = btn('kin');
kinBtn.addEventListener('click', () => {
  vis.showAllKin = !vis.showAllKin;
  kinBtn.setAttribute('aria-pressed', String(vis.showAllKin));
  kinBtn.textContent = vis.showAllKin ? 'all kin' : 'kin';
  refit();
  paint();
  clampPanHere();
  applyTransform();
});

// ── search
const search = btn('search');
const results = btn('results');
search.addEventListener('input', () => {
  const q = search.value.trim().toLowerCase();
  results.innerHTML = '';
  if (q.length < 2) { results.hidden = true; return; }
  const hits = [
    ...people.filter((p) => p.name.toLowerCase().includes(q))
      .map((p) => ({ kind: 'person', id: p.id, label: p.name })),
    ...events.filter((e) => e.title.toLowerCase().includes(q))
      .map((e) => ({ kind: 'event', id: e.id, label: `${e.title} (${yearOf(e.date)})` })),
  ].slice(0, 10);
  results.hidden = !hits.length;
  for (const h of hits) {
    const o = document.createElement('option');
    o.value = h.label;
    o.dataset.kind = h.kind;
    o.dataset.id = h.id;
    results.appendChild(o);
  }
});
search.addEventListener('change', () => {
  const o = [...results.options].find((o) => o.value === search.value);
  if (!o) return;
  // Searching for someone hidden by the kin filter must still find them.
  if (o.dataset.kind === 'person' && !vis.ids.has(o.dataset.id)) {
    vis.showAllKin = true;
    kinBtn.setAttribute('aria-pressed', 'true');
    kinBtn.textContent = 'all kin';
  }
  select(o.dataset.kind, o.dataset.id);
  search.value = '';
  results.hidden = true;
});

// ── keyboard
document.addEventListener('keydown', (ev) => {
  if (ev.target.tagName === 'INPUT') {
    if (ev.key === 'Escape') ev.target.blur();
    return;
  }
  if (ev.key === 'Escape') deselect();
  if (ev.key === '+' || ev.key === '=') zoomAt(1.35, stage.clientHeight / 2);
  if (ev.key === '-') zoomAt(1 / 1.35, stage.clientHeight / 2);
  const step = 80;
  const pan = { ArrowDown: [0, -step], ArrowUp: [0, step], ArrowLeft: [step, 0], ArrowRight: [-step, 0] }[ev.key];
  if (pan) {
    ev.preventDefault();
    view.tx += pan[0];
    view.ty += pan[1];
    clampPanHere();
    applyTransform();
  }
});

/** Fit the whole span, and park the gutter so the tree fills the left while the
 *  event rail and its labels stay clear of the gloss. */
export function fit() {
  const h = stage.clientHeight, w = stage.clientWidth;
  view.scale = Math.max(MIN_SCALE, (h - 90) / Math.max(1, YEAR_MAX - YEAR_MIN));
  refit();
  view.ty = 50;
  view.tx = w * 0.62;
  clampPanHere();
  applyTransform();
  paint();
}
