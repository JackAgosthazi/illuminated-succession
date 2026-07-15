/* Layout: the shared time axis, lane packing, and who is on screen.
 *
 * WHY PACK A SUBSET rather than everyone: ~110 people with overlapping lives need
 * ~30 lanes, which is ~3,500px of genealogy — that shoves the event rail off screen
 * and defeats the entire point of the app, which is seeing descent, chronology, and
 * the links between them AT ONCE. At any given year only a handful of MONARCHS are
 * alive, so the default view packs into ~6 lanes and everything fits. Kin fan out on
 * selection, and the `kin` toggle shows all of them for those who want the thicket.
 */

import { frac } from './dates.js';
import { AXIS_W, DEFAULT_SCALE, FEATURED, GEN_PAD, LANE_PAD_Y, LANE_W, NAME_ROOM } from './config.js';
import { E, L, P, childrenOf, edgeById, events, placed } from './model.js';

/** Mutable view state. Panning and zooming mutate this; nothing else should. */
export const view = { scale: DEFAULT_SCALE, tx: 0, ty: 0 };

/* The axis spans the data, not the title: ancestors predate 1042 and heirs outlive
 * 1422, and showing their real lifespans is more honest than clipping them. */
export const YEAR_MIN = Math.min(
  ...placed.map((p) => p._y0), ...events.map((e) => frac(e.date)));
export const YEAR_MAX = Math.max(
  ...placed.map((p) => p._y1), ...events.map((e) => frac(e.endDate || e.date)));

export const yPx = (year) => (year - YEAR_MIN) * view.scale;
export const laneX = (i) => -(GEN_PAD + i * LANE_W);

export const lanes = [];
/** x of the outermost lane in use — the left edge of the drawn world. */
export let worldLeft = laneX(0);

/* Greedy interval packing over the VISIBLE people. Monarchs go first so the
 * succession sits nearest the gutter. A monarch's life overlaps their successor's,
 * so monarchs legitimately spread across the first few lanes — that overlap is
 * information (two kings alive at once), not a defect to be packed away. */
export function relayout(visibleIds) {
  const vis = placed.filter((p) => visibleIds.has(p.id));
  const order = [
    ...vis.filter((p) => p.monarch).sort((a, b) => (a._rs ?? a._y0) - (b._rs ?? b._y0)),
    ...vis.filter((p) => !p.monarch).sort((a, b) => a._y0 - b._y0),
  ];
  lanes.length = 0;
  for (const p of order) {
    const top = p._y0 - LANE_PAD_Y;   // clearance for the name label above the bar
    const bot = p._y1;
    let li = lanes.findIndex((lane) => lane.every((q) => bot < q.top || top > q.bot));
    if (li === -1) { lanes.push([]); li = lanes.length - 1; }
    lanes[li].push({ top, bot, p });
    p._lane = li;
    p._x = laneX(li);
  }
  worldLeft = laneX(Math.max(0, lanes.length - 1)) - LANE_W * 0.5;
}

// ── visibility

/** Always shown: the monarchs, the disputed claimants, and the two featured magnates.
 *  Everyone else — consorts, siblings, children — fans out on selection or via `kin`. */
export const baseVisible = new Set(
  placed.filter((p) => p.monarch || p._claim || FEATURED.has(p.id)).map((p) => p.id));

export const vis = { showAllKin: false, ids: new Set(baseVisible) };

function kinOf(id) {
  const p = P.get(id);
  if (!p) return [];
  return [
    id,
    ...(p.parents || []),
    ...(p.spouses || []).map((s) => s.id),
    ...(childrenOf.get(id) || []),
  ].filter((x) => P.has(x) && !P.get(x)._undated);
}

/** The two person ids a genealogical edge joins, whichever kind it is. */
export function edgeEnds(edgeId) {
  const e = edgeById.get(edgeId);
  if (!e) return [];
  return e.kind === 'pc' ? [e.parent.id, e.child.id] : [e.a.id, e.b.id];
}

/** Who should be on screen given the current selection. */
export function computeVisible(sel) {
  if (vis.showAllKin) return new Set(placed.map((p) => p.id));
  const v = new Set(baseVisible);
  if (!sel) return v;

  if (sel.kind === 'person') {
    for (const x of kinOf(sel.id)) v.add(x);
  } else if (sel.kind === 'edge') {
    for (const end of edgeEnds(sel.id)) for (const k of kinOf(end)) v.add(k);
  } else if (sel.kind === 'event') {
    for (const a of E.get(sel.id)?.actors || []) v.add(a);
  } else if (sel.kind === 'link') {
    const l = L.get(sel.id);
    for (const side of [l?.from, l?.to].filter(Boolean)) {
      if (side.kind === 'person') for (const k of kinOf(side.id)) v.add(k);
      if (side.kind === 'edge') for (const end of edgeEnds(side.id)) v.add(end);
    }
  }
  return v;
}

/** Is this link's geometry drawable right now? Events are always present; a person
 *  or edge endpoint may be fanned out of view. */
export function linkReachable(side) {
  if (side.kind === 'person') return vis.ids.has(side.id);
  if (side.kind === 'edge') {
    const ends = edgeEnds(side.id);
    return ends.length > 0 && ends.every((id) => vis.ids.has(id));
  }
  return true;
}

/** Where a link attaches. A person attaches on their own bar at the year of the
 *  event it links to, clamped to their lifespan — so the connector stays as short
 *  and as literal as the geometry allows. */
export function anchor(side, otherYear) {
  if (side.kind === 'person') {
    const p = P.get(side.id);
    if (!p || p._undated) return null;
    return { x: p._x, y: Math.max(p._y0, Math.min(p._y1, otherYear ?? p._y0)) };
  }
  if (side.kind === 'event') {
    const e = E.get(side.id);
    return e ? { x: 0, y: frac(e.date) } : null;   // x replaced by EVT_X at draw time
  }
  if (side.kind === 'edge') {
    const e = edgeById.get(side.id);
    if (!e) return null;
    return e.kind === 'pc'
      ? { x: (e.parent._x + e.child._x) / 2, y: e.y }
      : { x: (e.a._x + e.b._x) / 2, y: e.y };
  }
  return null;
}

/** Keep the axis reachable and the event rail on screen. The rail's bound WINS when
 *  the two conflict (min before max): being able to see the chronology beside the
 *  descent is the point of the page. */
export function clampPan(stageW, stageH, evtLabelX, evtLabelRoom) {
  const contentH = (YEAR_MAX - YEAR_MIN) * view.scale;
  view.ty = Math.min(60, Math.max(stageH - contentH - 60, view.ty));
  const minTx = stageW - (evtLabelX + evtLabelRoom);
  // Names are right-aligned and extend LEFT of their bar, so the leftmost lane needs
  // label room too — otherwise a long name ("Edgar Ætheling") is drawn over the year
  // axis, which sits in a group the world is painted on top of.
  const maxTx = AXIS_W + NAME_ROOM - worldLeft;
  view.tx = Math.max(minTx, Math.min(maxTx, view.tx));
}
