/* The model: turn the validated dataset into something drawable, and index the
 * relationships the UI needs to answer "what is connected to this?".
 *
 * The one rule that governs this file: NEVER invent a date. Where a birth or death
 * is unsourced we anchor on whatever IS sourced and mark the end open, so the bar
 * can be drawn fading rather than terminating in a fabricated year.
 */

import { frac } from './dates.js';
import { RANGE, REGNAL } from './config.js';

const DATA = window.DATASET;

export const people = (DATA?.people || []).map((p) => ({ ...p }));
export const events = (DATA?.events || []).map((e) => ({ ...e }));
export const links = (DATA?.links || []).map((l) => ({ ...l }));
export const meta = DATA?.meta || { counts: {} };

export const P = new Map(people.map((p) => [p.id, p]));
export const E = new Map(events.map((e) => [e.id, e]));
export const L = new Map(links.map((l) => [l.id, l]));

// ── vertical extent per person

for (const p of people) {
  const b = frac(p.birth?.date);
  const d = frac(p.death?.date);
  const rs = frac(p.reign?.start);
  const re = frac(p.reign?.end);
  const marriages = (p.spouses || []).map((s) => frac(s.married)).filter(Boolean);
  const anchors = [b, d, rs, re, ...marriages].filter((v) => v != null);

  p._b = b; p._d = d; p._rs = rs; p._re = re;
  p._openStart = b == null;
  p._openEnd = d == null;
  p._undated = anchors.length === 0;

  /* A one-sided bound ("before 1030", "after 1070") is NOT a known date: the bar must
   * not terminate on it as though it were. Mark those ends fuzzy so they draw dashed.
   * `range` is excluded — its bounds ARE real dates (Edward I's "17/18 June 1239" is
   * known to within a day), so it needs no hedging in the drawing. */
  const oneSided = (prec) => prec === 'after' || prec === 'before';
  p._fuzzyStart = oneSided(p.birth?.precision);
  p._fuzzyEnd = oneSided(p.death?.precision);

  if (p._undated) { p._y0 = p._y1 = null; continue; }
  // An open end gets a short stub off the nearest sourced anchor, drawn dashed.
  // The stub is a drawing decision, not a claim about when they were born.
  p._y0 = b != null ? b : Math.min(...anchors) - 8;
  p._y1 = d != null ? d : Math.max(...anchors) + 8;
  if (p._y1 < p._y0) p._y1 = p._y0 + 1;
}

/** People with at least one sourced date — the only ones we can place on a time axis. */
export const placed = people.filter((p) => !p._undated);
/** People we refuse to place, listed honestly in the gloss instead of guessed at. */
export const undated = people.filter((p) => p._undated);

/* Dashed gold = a CONTESTED claim on this chart's succession. Two guards, because a
 * dashed bar is an assertion about someone and a false one is a fabricated claim:
 *   1. the title must be regnal AND about England (see REGNAL)
 *   2. it must overlap the chart's range — a real reign that ended before 1042 (Cnut)
 *      is out of scope, not disputed */
for (const p of placed) {
  p._claim = null;
  if (p.monarch) continue;
  const t = (p.titles || []).find((t) => {
    if (!REGNAL.test(t.title || '') || !t.from || frac(t.from) == null) return false;
    const s = frac(t.from);
    const e = frac(t.to) ?? s + 1;
    return e >= RANGE.start && s <= RANGE.end;
  });
  if (t) p._claim = { s: frac(t.from), e: frac(t.to) ?? frac(t.from) + 1, title: t.title };
}

// ── relationship indexes

/** parentId -> [childId] (the schema stores descent on the child, as `parents`). */
export const childrenOf = new Map();
for (const p of people) {
  for (const par of p.parents || []) {
    if (!P.has(par)) continue;
    if (!childrenOf.has(par)) childrenOf.set(par, []);
    childrenOf.get(par).push(p.id);
  }
}

/** Descent edges. A child's birth year is where the edge meets both bars, so the
 *  line is horizontal by construction — no generation rows, no fudging.
 *  `kind` lives on the edge itself: consumers resolve edges out of `edgeById` and
 *  must be able to tell descent from marriage without a parallel lookup. */
export const pcEdges = [];
for (const p of placed) {
  for (const par of p.parents || []) {
    const q = P.get(par);
    if (!q || q._undated || p._b == null) continue;
    pcEdges.push({ id: `${par}--${p.id}`, kind: 'pc', parent: q, child: p, y: p._b });
  }
}

/** Marriage edges, deduped — either partner may record the marriage. */
export const spEdges = [];
const spSeen = new Set();
for (const p of placed) {
  for (const s of p.spouses || []) {
    const q = P.get(s.id);
    if (!q || q._undated) continue;
    const key = [p.id, s.id].sort().join('~');
    if (spSeen.has(key)) continue;
    const y = frac(s.married);
    if (y == null) continue;   // an undated marriage has no y, so it cannot be drawn
    spSeen.add(key);
    spEdges.push({ id: key, kind: 'sp', a: p, b: q, y, rec: s });
  }
}

export const edgeById = new Map([...pcEdges, ...spEdges].map((e) => [e.id, e]));

/** "person:id" | "event:id" | "edge:id" -> [link] */
export const linksByNode = new Map();
for (const l of links) {
  for (const side of [l.from, l.to]) {
    const key = `${side.kind}:${side.id}`;
    if (!linksByNode.has(key)) linksByNode.set(key, []);
    linksByNode.get(key).push(l);
  }
}

/** personId -> [eventId] they were directly involved in. */
export const eventsByActor = new Map();
for (const e of events) {
  for (const a of e.actors || []) {
    if (!eventsByActor.has(a)) eventsByActor.set(a, []);
    eventsByActor.get(a).push(e.id);
  }
}

/** Monarchs in reign order — the spine the gold succession thread is drawn along. */
export const monarchs = placed
  .filter((p) => p.monarch && p._rs != null)
  .sort((a, b) => a._rs - b._rs);
