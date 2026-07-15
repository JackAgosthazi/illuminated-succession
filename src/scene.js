/* Scene construction: build every SVG node once, and keep handles to them.
 *
 * We deliberately build the DOM a single time and thereafter only rewrite
 * attributes. The alternative — re-rendering on zoom — would drop selection state
 * and re-bind hundreds of listeners on every wheel tick.
 *
 * Layer order is the drawing order, so it is load-bearing: correlations sit UNDER
 * the bars they connect, and all text sits on top of everything.
 */

import { SVG_NS, SIG_R, CAT_COLOR, FEATURED } from './config.js';
import { events, links, pcEdges, placed, spEdges } from './model.js';

export const svg = document.getElementById('codex');
export const gAxis = document.getElementById('axis');
export const gWorld = document.getElementById('world');
export const stage = document.getElementById('stage');
export const glossEl = document.getElementById('gloss');

export function el(name, attrs = {}, parent = null) {
  const e = document.createElementNS(SVG_NS, name);
  for (const [k, v] of Object.entries(attrs)) if (v != null) e.setAttribute(k, v);
  if (parent) parent.appendChild(e);
  return e;
}

export const layers = {};
for (const name of ['bands', 'corr', 'edges', 'succession', 'bars', 'events', 'labels']) {
  layers[name] = el('g', { class: `layer-${name}` }, gWorld);
}

/** kind -> Map(id -> {handles}) */
export const nodes = { person: new Map(), event: new Map(), edge: new Map(), link: new Map() };
export let succPath = null;

/**
 * @param {(kind: string, id: string) => void} onSelect
 * @param {(kind: string|null, id?: string) => void} onHover
 */
export function buildScene(onSelect, onHover) {
  // ── genealogy edges. A transparent fat `-hit` path sits under each thin visible
  //    line: a 1px line is unclickable, but the user must be able to click descent.
  for (const e of [...pcEdges, ...spEdges]) {
    const g = el('g', { class: 'edge-g' }, layers.edges);
    const path = el('path', {
      class: 'edge dimmable' + (e.kind === 'sp' ? ' spouse' : ''),
    }, g);
    const hit = el('path', { class: 'edge-hit' }, g);
    hit.addEventListener('click', (ev) => { ev.stopPropagation(); onSelect('edge', e.id); });
    nodes.edge.set(e.id, { g, path, hit, kind: e.kind, data: e });
  }

  succPath = el('path', { class: 'succession dimmable' }, layers.succession);

  // ── person bars
  for (const p of placed) {
    const g = el('g', { class: 'person-g' }, layers.bars);
    // A featured magnate is tinted verdigris: they have no descent line to the throne,
    // so the bar must read as a different kind of thing. Keyed off FEATURED, not
    // `role` — every consort has a role, and tinting them all would make "magnate"
    // meaningless.
    const cls = p.monarch ? ' is-monarch' : FEATURED.has(p.id) ? ' is-magnate' : '';
    const life = el('line', { class: 'life dimmable' + cls }, g);
    const reign = (p.monarch && p._rs != null)
      ? el('line', { class: 'reign-bar dimmable' }, g) : null;
    const claim = p._claim
      ? el('line', { class: 'reign-bar disputed dimmable' }, g) : null;
    const hit = el('rect', { class: 'person-hit', width: 16 }, g);
    hit.addEventListener('click', (ev) => { ev.stopPropagation(); onSelect('person', p.id); });
    hit.addEventListener('mouseenter', () => onHover('person', p.id));
    hit.addEventListener('mouseleave', () => onHover(null));

    const label = el('text', { class: 'pname dimmable' + cls, 'text-anchor': 'end' }, layers.labels);
    // A trailing "?" marks a bar whose extent is open because a date is unsourced.
    label.textContent = p.name + (p._openStart || p._openEnd ? ' ?' : '');

    nodes.person.set(p.id, { g, life, reign, claim, hit, label, p });
  }

  // ── events
  for (const e of events) {
    const g = el('g', { class: 'event-g' }, layers.events);
    const span = (e.endDate) ? el('line', { class: 'evt-tick dimmable' }, g) : null;
    const leader = el('path', { class: 'evt-leader dimmable' }, g);
    const dot = el('circle', {
      class: 'evt-dot dimmable', r: SIG_R[e.significance] || 3,
      fill: CAT_COLOR[e.category] || 'var(--text-soft)',
    }, g);
    const label = el('text', { class: 'evt-label dimmable' }, layers.labels);
    const go = (ev) => { ev.stopPropagation(); onSelect('event', e.id); };
    dot.addEventListener('click', go);
    label.addEventListener('click', go);
    dot.addEventListener('mouseenter', () => onHover('event', e.id));
    dot.addEventListener('mouseleave', () => onHover(null));
    nodes.event.set(e.id, { g, dot, label, leader, span, e });
  }

  // ── correlations
  for (const l of links) {
    const g = el('g', { class: 'corr-g' }, layers.corr);
    const path = el('path', {
      class: 'corr dimmable' + (l.strength === 'attributed' ? ' attributed' : ''),
    }, g);
    const hit = el('path', { class: 'corr-hit' }, g);
    hit.addEventListener('click', (ev) => { ev.stopPropagation(); onSelect('link', l.id); });
    nodes.link.set(l.id, { g, path, hit, l });
  }
}
