# The Illuminated Succession

An interactive chart of the English monarchs and their immediate families from
Edward the Confessor to Henry V (1042–1422), set against the period's major events,
with the sourced connections between the two drawn as clickable links.

**Live: https://jackagosthazi.github.io/illuminated-succession/**

Deploy with `build/deploy.sh` — it validates before it publishes, and refuses to ship a
dataset that breaks the sourcing rules below.

## The idea

Genealogy and chronology share **one vertical time axis**. `y` is always a year.

- A **person** is a vertical lifespan bar. The reigning stretch is struck in gold.
- A **descent** line springs from the parent's bar at the year the child was born,
  so it is horizontal by construction.
- An **event** sits in the rail right of the gutter, at its own date.
- A **correlation** is therefore a *short* link across the gutter. Temporal
  coincidence is visible in the geometry rather than asserted by the page.

Most family trees flatten time into generation rows and lose it. Putting both leaves
on a shared axis is what makes "what was happening when this person was alive, and
which of it did they cause?" a question the picture can answer.

## Sourcing rules

The whole point is that nothing here is unsourced, so the build enforces it:

- Every factual field carries a citation with a URL **and a verbatim quote** from
  that page. The quote is the audit trail — the UI shows it next to the link so a
  reader can click through and find those words.
- `build/merge.py` refuses to emit a dataset that violates the rules. It checks
  schema conformance, id uniqueness, dangling references, citation completeness,
  date sanity (nobody dies before they are born; no parent born after their child),
  and **precision honesty** — `year` precision beside a full ISO day is a
  contradiction and fails the build.
- `--check-urls` additionally probes every distinct citation URL and fails on dead
  links.
- Uncertainty is modelled, not smoothed over. `precision: circa` at day granularity
  requires an `uncertain` note naming who disagrees. A `range` value of
  `"1156-04/1156-12"` is an *uncertainty window*; a `range` with an `endDate` is a
  known *duration*. The two are opposite claims and the schema keeps them apart.
- `significance` (1–5) on events is the one editorial field, and the UI labels it as
  such.

See `data/SCHEMA.md` for the full contract.

## Scope note

Beyond the monarchs and their immediate kin, the dataset admits a few non-royal
figures of the first rank whose careers span reigns — William Marshal, for instance,
who has no descent line to the crown and earns his place through the correlation
layer instead. They carry a `role` and render in verdigris.

## Design

Palette is actual scriptorium pigment: vellum ground, iron-gall ink (brown-black, as
it really oxidises), lapis ultramarine, vermilion, gold leaf, verdigris. Dark theme
is a candlelit scriptorium. Type is UnifrakturMaguntia for display and Cardo for
body — Cardo is a face designed for medieval scholarship.

Both fonts are OFL and **inlined as data URIs**: the published Artifact runs under a
CSP that blocks every external host, so a linked font would fail silently to a system
serif.

## Build

No bundler. esbuild is unusable in this environment, and the page has no dependency
graph worth one.

The source is real ES modules — but a published Artifact is one HTML file under a CSP
that blocks every external host, so `import` from a sibling file could never resolve.
So `bundle.py` concatenates the modules in dependency order, strips the import/export
syntax, and wraps the result in an IIFE. That is what a bundler does for a
single-scope output, minus 40MB of node_modules.

Because the modules share one scope after concatenation, top-level names must be
unique *across* modules. `bundle.py` enforces this and fails the build on a clash —
it has already caught one real collision that would otherwise have silently broken
the page.

```sh
python3 build/make-fonts.py          # fetch OFL faces, emit src/fonts.css (data URIs)
python3 build/make-ids.py            # emit shards/_IDS.md, the closed id list for researchers
python3 build/merge.py               # validate shards -> data/dataset.json
python3 build/merge.py --check-urls  # ...and verify every citation link resolves
python3 build/bundle.py              # inline everything -> dist/index.html
build/deploy.sh "message"            # all of the above, then push to GitHub Pages
```

`dist/index.html` is fully self-contained — one file, no external requests at all (a
CSP-blocked font CDN is why the faces are inlined). Open it directly from disk, host it
anywhere, or let `deploy.sh` copy it to `docs/` for Pages.

`build/fix-precision.py` is a one-off, idempotent set of corrections where a
researcher's precision *label* contradicted their own prose. Every entry quotes the
record's own `uncertain` note as justification; none of them changes a fact.

## Layout

```
data/
  SCHEMA.md          the data contract; read this first
  shards/            per-researcher output, one file per slice of the period
  shards/_IDS.md     generated — the closed list of ids a link may reference
  dataset.json       generated — merged and validated
src/                 ES modules, in dependency order:
  dates.js             parse/format dates without upgrading their precision
  config.js            geometry + palette constants
  model.js             dataset -> drawable model, relationship indexes
  layout.js            time axis, lane packing, visibility, pan clamping
  scene.js             build the SVG once, keep handles
  position.js          write geometry for the current zoom
  gloss.js             margin-panel HTML (pure; no listeners, so no cycle)
  select.js            selection, focus lighting, kin fan-out
  controls.js          pan, zoom, search, keyboard
  main.js              boot
  index.template.html
  styles.css         tokens + scriptorium palette, both themes
  fonts.css          generated — inlined woff2
build/
  make-fonts.py  make-ids.py  merge.py  bundle.py
dist/
  index.html         generated — the whole app in one file
```

Module order in `build/bundle.py`'s `MODULES` list is the dependency order. Nothing
imports anything later in that list, so the graph stays acyclic — `gloss.js` is
deliberately pure HTML generation (its buttons carry `data-` attributes that
`controls.js` reads via one delegated handler) precisely so it does not need
`select.js` back.

## Orchestration notes, for anyone extending the data

Researchers ran as parallel agents, one per slice of the period. Two lessons are
baked into the tooling now:

- **Write incrementally.** Three agents were killed by mid-task API errors after
  doing all their research and losing every unwritten byte. Shard authors are told to
  rewrite a complete valid array after each small batch.
- **Regenerate `_IDS.md` only when the people shards are final.** It was generated
  once while a people agent was still mid-write, and the links researchers
  consequently dropped real connections (the Beaufort legitimation, Catherine of
  Valois behind the Treaty of Troyes) because those ids looked nonexistent. One
  researcher caught it and flagged it; a stale id list silently costs coverage.
