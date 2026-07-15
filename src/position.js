/* Positioning: write geometry onto the scene for the current scale.
 *
 * Text and strokes must not stretch, so the world group NEVER carries a scale() —
 * only a translate() for panning. Everything vertical is therefore recomputed in JS
 * whenever the zoom changes.
 */

import { frac, truncate } from './dates.js';
import {
  AXIS_W, EVT_LABEL_CHARS, EVT_LABEL_X, EVT_X, FEATURED, MIN_LABEL_GAP,
} from './config.js';
import { E, events, monarchs } from './model.js';
import { YEAR_MAX, YEAR_MIN, anchor, linkReachable, view, vis, worldLeft, yPx } from './layout.js';
import { gAxis, gWorld, layers, nodes, stage, succPath } from './scene.js';

export function applyTransform() {
  gWorld.setAttribute('transform', `translate(${view.tx},${view.ty})`);
  gAxis.setAttribute('transform', `translate(0,${view.ty})`);
}

/* Progressive disclosure by zoom: at 440 years on one screen, 103 event labels are
 * an unreadable stack, so only the heaviest survive. Returns the minimum
 * significance whose labels are shown. */
function labelLOD() {
  if (view.scale < 4) return 5;
  if (view.scale < 7.5) return 4;
  if (view.scale < 13) return 3;
  return 1;
}

/* Year rules and labels live in a viewport-fixed group that only pans vertically,
 * so the axis stays legible against the left edge however far you scroll sideways. */
function positionAxis() {
  gAxis.textContent = '';
  const vw = stage.clientWidth;
  const s = view.scale;
  const step = s < 3.5 ? 50 : s < 8 ? 20 : s < 18 ? 10 : 5;
  const start = Math.floor(YEAR_MIN / step) * step;

  for (let y = start; y <= YEAR_MAX; y += step) {
    const py = yPx(y);
    const century = y % 100 === 0;
    gAxis.appendChild(rule(AXIS_W, py, vw, century));
    const t = document.createElementNS('http://www.w3.org/2000/svg', 'text');
    t.setAttribute('class', 'year-label');
    t.setAttribute('x', AXIS_W - 8);
    t.setAttribute('y', py + 3.5);
    t.setAttribute('text-anchor', 'end');
    t.textContent = y;
    gAxis.appendChild(t);
  }
  // Alternating century bands, so the eye can hold its place while panning.
  for (let c = Math.floor(YEAR_MIN / 100) * 100; c <= YEAR_MAX; c += 200) {
    const r = document.createElementNS('http://www.w3.org/2000/svg', 'rect');
    r.setAttribute('class', 'century-band');
    r.setAttribute('x', AXIS_W);
    r.setAttribute('y', yPx(c));
    r.setAttribute('width', Math.max(0, vw - AXIS_W));
    r.setAttribute('height', 100 * view.scale);
    gAxis.insertBefore(r, gAxis.firstChild);
  }
}

function rule(x1, y, x2, century) {
  const l = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  l.setAttribute('class', 'year-rule' + (century ? ' decade' : ''));
  l.setAttribute('x1', x1); l.setAttribute('y1', y);
  l.setAttribute('x2', x2); l.setAttribute('y2', y);
  return l;
}

function positionPeople() {
  for (const [, n] of nodes.person) {
    const { p, life, reign, claim, hit, label } = n;
    const on = vis.ids.has(p.id);
    n.g.style.display = on ? '' : 'none';
    label.style.display = on ? '' : 'none';
    if (!on) continue;

    const a = yPx(p._y0), b = yPx(p._y1);
    life.setAttribute('x1', p._x); life.setAttribute('x2', p._x);
    life.setAttribute('y1', a); life.setAttribute('y2', b);
    // Dashed where an end is unsourced OR only one-sidedly bounded: in both cases the
    // bar's extent there is a drawing choice, not a claim about a date.
    if (p._openStart || p._openEnd || p._fuzzyStart || p._fuzzyEnd) {
      life.setAttribute('stroke-dasharray', '2 3');
    }
    if (reign) {
      reign.setAttribute('x1', p._x); reign.setAttribute('x2', p._x);
      reign.setAttribute('y1', yPx(p._rs));
      reign.setAttribute('y2', yPx(p._re ?? p._y1));
    }
    if (claim) {
      claim.setAttribute('x1', p._x); claim.setAttribute('x2', p._x);
      claim.setAttribute('y1', yPx(p._claim.s));
      claim.setAttribute('y2', yPx(p._claim.e));
    }
    hit.setAttribute('x', p._x - 8);
    hit.setAttribute('y', a - 4);
    hit.setAttribute('height', Math.max(8, b - a + 8));

    // Monarchs, claimants and the featured magnates are always named; everyone else
    // resolves in as you zoom, so the default view stays readable.
    const named = p.monarch || !!p._claim || FEATURED.has(p.id) || view.scale >= 10;
    label.style.display = named ? '' : 'none';
    if (named) {
      label.setAttribute('x', p._x - 7);
      label.setAttribute('y', a + 4);
    }
  }
}

function positionEdges() {
  for (const [, n] of nodes.edge) {
    const e = n.data;
    const ends = n.kind === 'pc' ? [e.parent.id, e.child.id] : [e.a.id, e.b.id];
    const on = ends.every((id) => vis.ids.has(id));
    n.g.style.display = on ? '' : 'none';
    if (!on) continue;

    let d;
    if (n.kind === 'pc') {
      const x1 = e.parent._x, x2 = e.child._x, y = yPx(e.y);
      // Both ends sit at the child's birth year, so the line is horizontal. A slight
      // sag proportional to the span separates siblings born the same year.
      const bow = Math.min(16, Math.abs(x2 - x1) * 0.07);
      d = `M${x1},${y} Q${(x1 + x2) / 2},${y + bow} ${x2},${y}`;
    } else {
      d = `M${e.a._x},${yPx(e.y)} L${e.b._x},${yPx(e.y)}`;
    }
    n.path.setAttribute('d', d);
    n.hit.setAttribute('d', d);
  }
}

/* The gold thread: each monarch's reign, joined to the next. Read top to bottom it
 * is the succession itself — and every kink is a discontinuity worth asking about. */
function positionSuccession() {
  let d = '';
  for (let i = 0; i < monarchs.length; i++) {
    const m = monarchs[i];
    d += `${i === 0 ? 'M' : 'L'}${m._x},${yPx(m._rs)} L${m._x},${yPx(m._re ?? m._y1)} `;
    const next = monarchs[i + 1];
    if (next) d += `L${next._x},${yPx(next._rs)} `;
  }
  succPath.setAttribute('d', d.trim());
}

function positionEvents() {
  const lod = labelLOD();
  const shown = events.filter((e) => (e.significance || 0) >= lod);
  const shownIds = new Set(shown.map((e) => e.id));

  // Declutter in screen space: push each label below the previous one if they would
  // collide. Dots stay at their true year; a leader line owns the discrepancy.
  const labelY = new Map();
  let prev = -Infinity;
  for (const e of [...shown].sort((a, b) => frac(a.date) - frac(b.date))) {
    const y = Math.max(yPx(frac(e.date)), prev + MIN_LABEL_GAP);
    labelY.set(e.id, y);
    prev = y;
  }

  for (const [, n] of nodes.event) {
    const { e, dot, label, leader, span } = n;
    const y = yPx(frac(e.date));
    dot.setAttribute('cx', EVT_X);
    dot.setAttribute('cy', y);
    if (span) {
      const end = frac(e.endDate);
      const has = end != null && end > frac(e.date);
      span.style.display = has ? '' : 'none';
      if (has) {
        span.setAttribute('x1', EVT_X); span.setAttribute('x2', EVT_X);
        span.setAttribute('y1', y); span.setAttribute('y2', yPx(end));
        span.setAttribute('stroke-width', 2);
      }
    }
    const on = shownIds.has(e.id);
    label.style.display = on ? '' : 'none';
    leader.style.display = on ? '' : 'none';
    if (!on) continue;

    const ly = labelY.get(e.id);
    // SVG text neither wraps nor ellipsises; cut to the reserved column or it runs
    // under the gloss panel.
    label.textContent = truncate(e.title, EVT_LABEL_CHARS);
    label.setAttribute('x', EVT_LABEL_X);
    label.setAttribute('y', ly + 4);
    leader.setAttribute('d',
      `M${EVT_X + 7},${y} C${EVT_X + 13},${y} ${EVT_LABEL_X - 8},${ly} ${EVT_LABEL_X - 3},${ly}`);
  }
}

function positionLinks() {
  for (const [, n] of nodes.link) {
    const l = n.l;
    const on = linkReachable(l.from) && linkReachable(l.to);
    n.g.style.display = on ? '' : 'none';
    if (!on) continue;

    const toY = l.to.kind === 'event' ? frac(E.get(l.to.id)?.date) : null;
    const frY = l.from.kind === 'event' ? frac(E.get(l.from.id)?.date) : null;
    const A = anchor(l.from, toY);
    const B = anchor(l.to, frY ?? A?.y);
    if (!A || !B) { n.path.removeAttribute('d'); n.hit.removeAttribute('d'); continue; }

    const ax = l.from.kind === 'event' ? EVT_X : A.x;
    const bx = l.to.kind === 'event' ? EVT_X : B.x;
    const ay = yPx(A.y), by = yPx(B.y);
    const mx = (ax + bx) / 2;
    const d = `M${ax},${ay} C${mx},${ay} ${mx},${by} ${bx},${by}`;
    n.path.setAttribute('d', d);
    n.hit.setAttribute('d', d);
  }
}

export function position() {
  positionAxis();
  positionPeople();
  positionEdges();
  positionSuccession();
  positionEvents();
  positionLinks();
  applyTransform();
}
