# Data schema — Illuminated Succession (1042–1422)

Hard rule: **every factual field must be supported by a citation with a real, working URL.**
If you cannot find a source, omit the field or omit the record. Never guess, never infer a date,
never "reconstruct" a plausible value. `null` and a short `uncertain` note are always better than
a fabricated value.

## ID conventions

- Person id: kebab-case. Regnal names use lowercase roman numerals: `william-i`, `henry-ii`,
  `edward-iii`, `richard-ii`.
- Non-regnal people: `firstname-descriptor`, e.g. `eleanor-aquitaine`, `matilda-empress`,
  `harold-godwinson`, `john-of-gaunt`, `edmund-crouchback`.
- Disambiguate collisions with a birth year: `edward-black-prince`, `eleanor-castile`.
- Event id: `evt-<year>-<slug>`, e.g. `evt-1066-hastings`, `evt-1215-magna-carta`.
- Link id: `lnk-<nnn>` (assigned at merge time; leave as `null` in shards).

Cross-shard references are expected and fine (a child in one shard may parent someone in the
next). Use the conventions above so IDs line up. If you reference a person you did not author,
still use the canonical id — do not invent a variant.

## citation object

Used everywhere. Array-valued fields take one or more.

```json
{
  "url": "https://www.britannica.com/biography/Edward-the-Confessor",
  "title": "Edward the Confessor | Biography, Reign, & Facts",
  "publisher": "Encyclopaedia Britannica",
  "quote": "Short verbatim quote (<=240 chars) from the source supporting the claim."
}
```

- `url` must be a page you actually fetched and read in this task. No guessed URLs, no
  URL patterns you assume exist.
- `quote` must be verbatim from that page. It is the audit trail — a reader clicks through
  and finds those words. Trim with `…` if needed but do not paraphrase inside quotes.
- Prefer, in order: Wikisource/primary-source editions and scholarly databases
  (British History Online, Oxford DNB if open, Fordham Internet Medieval Sourcebook,
  Anglo-Saxon Chronicle editions), Encyclopaedia Britannica, Wikipedia.
  Wikipedia is acceptable but prefer a better source when one is available.

## people.json — array of person

```json
{
  "id": "henry-ii",
  "name": "Henry II",
  "fullName": "Henry Curtmantle",
  "epithet": "Curtmantle",
  "house": "Plantagenet",
  "role": null,
  "monarch": true,
  "reign": { "start": "1154-12-19", "end": "1189-07-06", "citations": [ {…} ] },
  "birth": { "date": "1133-03-05", "place": "Le Mans", "precision": "day", "citations": [ {…} ] },
  "death": { "date": "1189-07-06", "place": "Chinon", "precision": "day", "citations": [ {…} ] },
  "parents": ["geoffrey-anjou", "matilda-empress"],
  "spouses": [
    { "id": "eleanor-aquitaine", "married": "1152-05-18", "precision": "day",
      "ended": "1189-07-06", "endedBy": "death", "citations": [ {…} ] }
  ],
  "titles": [ { "title": "Duke of Normandy", "from": "1150", "to": "1189", "citations": [ {…} ] } ],
  "summary": "2–4 sentences. Every substantive claim here must be covered by `citations`.",
  "citations": [ {…} ],
  "uncertain": "Optional. Note any date/relationship the sources disagree on, naming the disagreement."
}
```

- `precision`: one of `day` | `month` | `year` | `circa` | `range` | `after` | `before`.
  - `day` / `month` / `year` — the date is settled at that granularity. `year`
    precision must carry a bare `YYYY`: writing `year` beside `1167-12-24` is a
    contradiction and fails the build.
  - `circa` — the date is approximate OR reported-but-disputed. It may carry any
    granularity, so `"1167-12-24"` with `circa` is legal and means "c. 24 December
    1167, sources disagree". Because `circa` at day granularity is a strong claim,
    it **requires** an `uncertain` note naming the disagreement.
  - `range` — an uncertainty WINDOW: the date fell somewhere between two bounds and
    the sources do not settle where. Format the value as `"<date>/<date>"`, earliest
    first, at any granularity: `"1165/1170"`, or `"1156-04/1156-12"` where the year is
    agreed but the month is not. The UI renders "between X and Y" and lays the person
    out from the earliest bound.
  - `after` — the date is known only as a lower bound ("aft. 1333"). The value is that
    bound; the UI renders "after 1333".
  - `before` — the date is known only as an upper bound ("before 8 July 1332"). The
    value is that bound; the UI renders "before 8 July 1332".
  If a source says "c. 1003", use `date: "1003"`, `precision: "circa"`. Never invent
  a day or month a source does not give.

  Note `range` vs `after`/`before` vs an event's `endDate`, which are four different
  claims and must not be swapped: `range` is *one moment, unknown where in a window*;
  `after`/`before` is *one moment, bounded on one side only*; an `endDate` is a known
  **duration** with a real start and end. Reporting a doubt as a duration (or vice
  versa) misrepresents the source.

- Date **values** are `YYYY`, `YYYY-MM`, `YYYY-MM-DD`, or a `/`-joined window. Years
  may be 3 digits (Cnut was born c. 995) — the dataset's people extend either side of
  the 1042–1422 headline range, because ancestors predate it and heirs outlive it.
  Never put prose in a date field: `"circa 1020"` is invalid — that is
  `date: "1020"`, `precision: "circa"`.
- `spouses[].precision`: same vocabulary as any other date, describing `married`.
  A marriage known only as "c. 1020" is `married: "1020"`, `precision: "circa"` —
  never `married: "circa 1020"`.
- `parents`: biological parents only, by id. Omit unknowns rather than guessing.
- `monarch`: true only for those who reigned as English monarch. Claimants and
  disputed rulers (e.g. `matilda-empress`) get `monarch: false` plus a `titles` entry
  and an `uncertain` note explaining the dispute.
- `reign`: monarchs only; `null` otherwise.
- `role`: optional. The UI subtitle for a non-monarch, e.g. "Earl of Pembroke;
  Regent of England". Required for anyone who is neither a monarch nor royal kin
  (the dataset includes magnates such as `william-marshal` whose significance is
  their career, not their descent). Omit for monarchs — the UI says "Monarch of
  England" — and omit for plain royal relatives, which the UI labels "Royal kin".
- Scope of "immediate family": each monarch's parents, spouses, siblings, and children.
  The dataset also admits a small number of **non-royal figures of the first rank**
  whose careers span reigns; they carry `role`, `monarch: false`, `reign: null`, and
  earn their place through the `links.json` correlation layer rather than through
  descent lines to the crown.

## events.json — array of event

```json
{
  "id": "evt-1066-hastings",
  "title": "Battle of Hastings",
  "date": "1066-10-14",
  "endDate": null,
  "precision": "day",
  "category": "battle",
  "actors": ["william-i", "harold-godwinson"],
  "place": "Senlac Hill, Sussex",
  "significance": 5,
  "summary": "2–4 sentences, fully covered by citations.",
  "citations": [ {…} ],
  "uncertain": null
}
```

- `category`: `battle` | `succession` | `treaty` | `rebellion` | `church` | `law` |
  `crusade` | `plague` | `culture` | `economy` | `construction` | `dynastic`.
- `actors`: person ids of people in `people.json` who were directly involved. May be `[]`
  for events with no in-dataset actor (e.g. the Black Death's arrival).
- `significance`: 1–5, your editorial ranking of historical weight. Used for timeline
  emphasis. This is the one subjective field and it is labelled as such in the UI.
- `endDate`: for events spanning time (a siege, a parliament). Else `null`.

## links.json — curated causal claims

This is the correlation layer. **Only claims a cited source explicitly supports.**
Not "these happened around the same time" — a source must actually assert the connection.

```json
{
  "id": null,
  "from": { "kind": "edge", "id": "eleanor-aquitaine~henry-ii" },
  "to": { "kind": "event", "id": "evt-1173-great-revolt" },
  "relation": "rebellion-provoked",
  "claim": "One sentence stating the causal claim in the source's terms.",
  "strength": "explicit",
  "citations": [ {…} ]
}
```

Note the shape of that example: the marriage is the `from`, and its **consequence** is
the `to`. A marriage is not itself an event in this dataset — it is already drawn as a
marriage edge in the genealogy, so an event duplicating it would be circular. Link the
edge to what it caused. Every `to` id must exist in `data/shards/_IDS.md`.

- `from.kind`: `person` | `edge` (a genealogical relationship) | `event`.
  For `edge`, id is `"<parentId>--<childId>"` or `"<spouseA>~<spouseB>"`.
- `to.kind`: usually `event`.
- `relation`: short kebab-case verb phrase, e.g. `succession-triggered`,
  `marriage-enabled`, `claim-asserted-via`, `inheritance-disputed`, `alliance-sealed`.
- `strength`: `explicit` (source states the causal link outright) or
  `attributed` (source reports it as a contemporary/historiographical claim, not settled fact).
  If it is neither, **do not create the link.**
- `claim` must be defensible from `citations[].quote`. The quote is what the UI shows
  when a reader clicks the connecting line, next to the source link.

## Output rules for research agents

- Write **only** your assigned file. Valid JSON, UTF-8, array at top level. No comments,
  no trailing commas, no markdown fences.
- Return to the orchestrator: file written, record count, and a short list of anything
  you had to drop for lack of a source. Do not return the data itself.
