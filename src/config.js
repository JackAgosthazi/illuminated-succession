/* Geometry and visual constants.
 *
 * The whole layout rests on one rule: y is a year. Everything below is the
 * horizontal budget around that axis.
 *
 *   worldLeft ......... 0 ......... EVT_X .. EVT_LABEL_X ....
 *   [ genealogy lanes ][ gutter ][ dots ][ event titles     ]
 *
 * Genealogy grows leftward from the gutter at x=0; the event rail sits just right
 * of it. Lane 0 is nearest the gutter so the succession runs closest to the events
 * it caused.
 */

export const SVG_NS = 'http://www.w3.org/2000/svg';

export const LANE_W = 116;   // horizontal pitch between genealogy lanes
export const GEN_PAD = 96;   // gap from the gutter to lane 0
export const EVT_X = 74;     // event dots, right of the gutter
export const EVT_LABEL_X = 92;
export const EVT_LABEL_ROOM = 250;  // px reserved so event titles are never clipped
export const EVT_LABEL_CHARS = 42;  // ~EVT_LABEL_ROOM at 12px Cardo
export const AXIS_W = 54;    // sticky year axis, pinned to the left of the viewport
export const NAME_ROOM = 130; // px reserved left of the outermost lane for its name
export const LANE_PAD_Y = 5.5;   // years of clearance a bar needs above it for its name
export const MIN_LABEL_GAP = 13; // px, event label declutter

/* MIN_SCALE must be low enough that the whole 1042–1422 span (plus ancestors, who
 * predate it) fits a laptop viewport at "fit" — otherwise the last monarchs fall
 * off the bottom of the default view. */
export const MIN_SCALE = 1.6;
export const MAX_SCALE = 42;
export const DEFAULT_SCALE = 7;

/* Event dot radius by editorial significance (1–5). */
export const SIG_R = { 1: 2.2, 2: 2.8, 3: 3.6, 4: 4.6, 5: 6 };

/* Category → pigment. Deliberately NOT one colour per category: the palette is
 * six pigments and grouping categories onto them keeps the page readable as a
 * manuscript rather than a legend. */
export const CAT_COLOR = {
  battle: 'var(--vermilion)', rebellion: 'var(--vermilion)',
  succession: 'var(--reign)', dynastic: 'var(--reign)',
  treaty: 'var(--lapis)', law: 'var(--lapis)',
  church: 'var(--murex)', crusade: 'var(--murex)',
  plague: 'var(--verdigris)', culture: 'var(--verdigris)', economy: 'var(--verdigris)',
  construction: 'var(--text-soft)',
};

/* A non-monarch holding a regnal title OVER ENGLAND earns a dashed gold bar: dashed
 * reads as contested rather than as a reign. Catches the Empress Matilda ("Lady of
 * the English"), Edgar the Ætheling (proclaimed, never crowned), and Henry the Young
 * King (crowned co-king in his father's lifetime).
 *
 * It MUST be anchored to England. An earlier version matched any /king|queen/ and so
 * drew dashed gold "disputed claim" bars over Louis VII, Cnut, Malcolm III, David II
 * and Frederick II — asserting that a dozen foreign monarchs held contested claims to
 * the English throne. Their crowns were real and elsewhere; the dataset carries them
 * as consorts and kin. `role` still names their actual title in the gloss. */
export const REGNAL = /\b(king|queen|lady|domina)\b[^,;]{0,14}\b(england|english)\b/i;

/* The chart's headline range. A dashed claim bar is only meaningful for a claim on
 * THIS succession, so an English regnal title that ends before the range begins is
 * not a contested claim — it is a real reign outside our scope. That is what excludes
 * Cnut (King of England 1016–1035, uncontested, and in this dataset only as Emma of
 * Normandy's husband) while keeping Edgar the Ætheling (1066), the Empress Matilda
 * (1141) and Henry the Young King (1170–83). */
export const RANGE = { start: 1042, end: 1422 };

/* Non-royal figures shown on the spine by default, alongside the monarchs and
 * claimants. This is an editorial choice and a deliberately short list: both are
 * magnates whose careers thread multiple reigns and whose significance is
 * correlational rather than dynastic — they have no descent line to the crown, and
 * the correlation layer is where they earn their place.
 *
 * It is NOT derived from `role`, which every consort carries (Louis VII is "King of
 * France"). Keying visibility off `role` put ~80 consorts on the spine permanently and
 * collapsed the monarchs-first layout that keeps the event rail on screen. */
export const FEATURED = new Set([
  'william-marshal',    // Earl of Pembroke; regent 1216–19, saved Magna Carta by reissue
  'simon-de-montfort',  // Earl of Leicester; the baronial reform movement, Lewes, Evesham
]);
