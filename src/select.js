/* Selection, focus lighting, and the gloss panel.
 *
 * Selecting is not just a highlight: it changes WHO IS ON SCREEN (kin fan out),
 * which changes lane packing, which moves every x. So the order in `select` is
 * load-bearing — decide visibility, repack, place, and only then centre on the
 * node's NEW position.
 */

import { AXIS_W, EVT_LABEL_ROOM, EVT_LABEL_X, EVT_X } from './config.js';
import { frac } from './dates.js';
import { E, L, P, childrenOf, edgeById, eventsByActor, linksByNode } from './model.js';
import { clampPan, computeVisible, edgeEnds, relayout, vis, view, yPx } from './layout.js';
import { applyTransform, position } from './position.js';
import { glossHTML } from './gloss.js';
import { glossEl, nodes, stage, succPath, svg } from './scene.js';

export const state = { sel: null, hoverKey: null };

/* Everything that should stay lit while one thing is focused: the node itself, the
 * correlations touching it AND their far ends, its family edges, and the events it
 * took part in. Anything not in this set is dimmed, which is what makes a single
 * thread legible in a chart of ~500 marks. */
function relatedSet(kind, id) {
  const lit = new Set([`${kind}:${id}`]);
  const addLinks = (key) => {
    for (const l of linksByNode.get(key) || []) {
      lit.add(`link:${l.id}`);
      lit.add(`${l.from.kind}:${l.from.id}`);
      lit.add(`${l.to.kind}:${l.to.id}`);
      for (const side of [l.from, l.to]) {
        if (side.kind === 'edge') for (const e of edgeEnds(side.id)) lit.add(`person:${e}`);
      }
    }
  };

  if (kind === 'person') {
    const p = P.get(id);
    addLinks(`person:${id}`);
    for (const par of p?.parents || []) {
      lit.add(`person:${par}`);
      lit.add(`edge:${par}--${id}`);
    }
    for (const c of childrenOf.get(id) || []) {
      lit.add(`person:${c}`);
      lit.add(`edge:${id}--${c}`);
    }
    for (const s of p?.spouses || []) {
      if (!P.has(s.id)) continue;
      lit.add(`person:${s.id}`);
      lit.add(`edge:${[id, s.id].sort().join('~')}`);
    }
    for (const eid of eventsByActor.get(id) || []) lit.add(`event:${eid}`);
  } else if (kind === 'event') {
    addLinks(`event:${id}`);
    for (const a of E.get(id)?.actors || []) lit.add(`person:${a}`);
  } else if (kind === 'link') {
    const l = L.get(id);
    if (l) {
      for (const side of [l.from, l.to]) {
        lit.add(`${side.kind}:${side.id}`);
        if (side.kind === 'edge') for (const e of edgeEnds(side.id)) lit.add(`person:${e}`);
      }
    }
  } else if (kind === 'edge') {
    addLinks(`edge:${id}`);
    for (const e of edgeEnds(id)) lit.add(`person:${e}`);
  }
  return lit;
}

export function paint() {
  const key = state.sel ? `${state.sel.kind}:${state.sel.id}` : state.hoverKey;
  svg.classList.toggle('has-focus', !!key);
  // split on the FIRST colon only — ids contain hyphens but never colons
  const lit = key ? relatedSet(key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)) : null;

  const mark = (map, prefix, els) => {
    for (const [id, n] of map) {
      const on = lit ? lit.has(`${prefix}:${id}`) : false;
      for (const e of els(n)) {
        if (!e) continue;
        e.classList.toggle('lit', on);
        e.classList.toggle('dimmable', !on);
      }
    }
  };
  mark(nodes.person, 'person', (n) => [n.life, n.reign, n.claim, n.label]);
  mark(nodes.event, 'event', (n) => [n.dot, n.label, n.leader, n.span]);
  mark(nodes.link, 'link', (n) => [n.path]);
  mark(nodes.edge, 'edge', (n) => [n.path]);
  succPath.classList.toggle('dimmable', !!lit);
}

/** Recompute visibility -> lanes -> geometry. Call after anything that changes who
 *  is on screen. */
export function refit() {
  vis.ids = computeVisible(state.sel);
  relayout(vis.ids);
  position();
}

function centerOn(kind, id) {
  let y = null, x = null;
  if (kind === 'person') {
    const p = P.get(id);
    if (p && !p._undated) { y = yPx((p._y0 + p._y1) / 2); x = p._x; }
  } else if (kind === 'event') {
    const e = E.get(id);
    if (e) { y = yPx(frac(e.date)); x = EVT_X; }
  } else if (kind === 'edge') {
    const e = edgeById.get(id);
    if (e) {
      y = yPx(e.y);
      x = e.kind === 'pc' ? (e.parent._x + e.child._x) / 2 : (e.a._x + e.b._x) / 2;
    }
  }
  if (y == null) return;

  const w = stage.clientWidth, h = stage.clientHeight;
  view.ty = h / 2 - y;
  // Only nudge sideways if the node landed outside the readable band — otherwise
  // selecting anything would yank the whole chart across.
  const sx = x + view.tx;
  const lo = AXIS_W + 70, hi = w - EVT_LABEL_ROOM - 30;
  if (sx < lo) view.tx += lo - sx;
  else if (sx > hi) view.tx -= sx - hi;
  clampPanHere();
  applyTransform();
}

export function clampPanHere() {
  clampPan(stage.clientWidth, stage.clientHeight, EVT_LABEL_X, EVT_LABEL_ROOM);
}

export function select(kind, id, opts = {}) {
  state.sel = { kind, id };
  state.hoverKey = null;
  refit();
  paint();
  glossEl.innerHTML = glossHTML(kind, id);
  glossEl.scrollTop = 0;
  glossEl.hidden = false;
  if (opts.center !== false) centerOn(kind, id);
}

export function deselect() {
  state.sel = null;
  state.hoverKey = null;
  refit();
  paint();
  glossEl.innerHTML = glossHTML(null);
}

export function hover(kind, id) {
  if (state.sel) return;   // a live selection outranks a passing cursor
  state.hoverKey = kind ? `${kind}:${id}` : null;
  paint();
}
