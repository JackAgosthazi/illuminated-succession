#!/usr/bin/env python3
"""Merge the research shards into one dataset and validate it hard.

The project rule is that nothing in the app is unsourced. That rule is only real
if something checks it, so this script refuses to emit a dataset that violates
it. Validation is split in two:

  structural (always)  — schema conformance, id uniqueness, dangling refs,
                         citation completeness, date sanity, precision honesty
  liveness (--check-urls) — every distinct citation URL must actually resolve

Run: python3 build/merge.py [--check-urls]
Exit 1 on any error. Warnings do not fail the build but are printed.
"""

import argparse
import collections
import concurrent.futures as futures
import json
import pathlib
import re
import sys
import urllib.error
import urllib.request

ROOT = pathlib.Path(__file__).parent.parent
SHARDS = ROOT / "data" / "shards"
OUT = ROOT / "data" / "dataset.json"

# Generous envelope. The headline range is 1042–1422, but the dataset's PEOPLE spill
# either side of it and that is correct: Cnut was born c. 995, and Henry V's brothers
# outlived him into the 1440s. Clipping them would be a lie about their lifespans.
PERIOD = (940, 1500)

# Independent researchers occasionally coined two ids for one person. The graph only
# joins up if those collapse to one, so map the variant onto the canonical id here.
# Every entry is a same-person identification confirmed against sources — this is
# NOT a place to paper over two genuinely distinct people (see edmund-mortimer vs
# edmund-mortimer-1352, who are grandson and grandfather and MUST stay separate).
ALIASES = {
    "isabella-castile": "isabella-castile-york",   # Isabella of Castile, Duchess of York
    "elizabeth-burgh": "elizabeth-burgh-ulster",   # Elizabeth de Burgh, 4th Countess of Ulster
}
PRECISIONS = {"day", "month", "year", "circa", "range", "after", "before"}
ONE_DATE = r"\d{3,4}(?:-\d{2}(?:-\d{2})?)?"
CATEGORIES = {
    "battle", "succession", "treaty", "rebellion", "church", "law",
    "crusade", "plague", "culture", "economy", "construction", "dynastic",
}
STRENGTHS = {"explicit", "attributed"}

errors: list[str] = []
warnings: list[str] = []


def err(msg):
    errors.append(msg)


def warn(msg):
    warnings.append(msg)


def load_shards(glob):
    out = []
    for p in sorted(SHARDS.glob(glob)):
        try:
            data = json.loads(p.read_text())
        except json.JSONDecodeError as e:
            err(f"{p.name}: invalid JSON — {e}")
            continue
        if not isinstance(data, list):
            err(f"{p.name}: top level must be an array, got {type(data).__name__}")
            continue
        for rec in data:
            rec["_shard"] = p.name
        out.extend(data)
        print(f"  {p.name:38} {len(data):>4} records")
    return out


def canon(pid):
    """Resolve an alias to its canonical person id."""
    return ALIASES.get(pid, pid)


def apply_aliases(people, events, links):
    """Rewrite every person reference through ALIASES before validation, so a
    variant id can never look like a dangling reference."""
    n = 0
    for p in people:
        if p.get("id") in ALIASES:
            # An alias must never be authored as its own record.
            err(f"person '{p['id']}' is an alias of '{ALIASES[p['id']]}' but was "
                f"authored as a record in {p.get('_shard')} — remove one")
        before = list(p.get("parents") or [])
        p["parents"] = [canon(x) for x in before]
        n += sum(1 for a, b in zip(before, p["parents"]) if a != b)
        for s in p.get("spouses") or []:
            if isinstance(s, dict) and s.get("id") in ALIASES:
                s["id"] = canon(s["id"])
                n += 1
    for e in events:
        before = list(e.get("actors") or [])
        e["actors"] = [canon(x) for x in before]
        n += sum(1 for a, b in zip(before, e["actors"]) if a != b)
    for l in links:
        for side in (l.get("from"), l.get("to")):
            if not isinstance(side, dict):
                continue
            if side.get("kind") == "person" and side.get("id") in ALIASES:
                side["id"] = canon(side["id"])
                n += 1
            elif side.get("kind") == "edge" and side.get("id"):
                rid = str(side["id"])
                sep = "--" if "--" in rid else "~" if "~" in rid else None
                if sep:
                    a, b = rid.split(sep, 1)
                    new = f"{canon(a)}{sep}{canon(b)}"
                    if new != rid:
                        side["id"] = new
                        n += 1
    if n:
        print(f"  resolved {n} aliased reference(s) via ALIASES")
    return n


# ---------------------------------------------------------------- dates

def year_of(date):
    """Leading year (3 or 4 digits) from an ISO-ish, bare-year, or window string.
    For a window this is the earliest bound — the only end we can place honestly."""
    if not date:
        return None
    m = re.match(r"^(\d{3,4})", str(date))
    return int(m.group(1)) if m else None


def frac_year(date):
    """Fractional year, so window bounds can be ordered at any granularity
    ('1156-04' < '1156-12'). Mirrors frac() in app.js."""
    m = re.match(r"^(\d{4})(?:-(\d{2}))?(?:-(\d{2}))?$", str(date))
    if not m:
        return None
    y, mo, d = int(m.group(1)), m.group(2), m.group(3)
    if not mo:
        return float(y)
    cum = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]
    doy = cum[int(mo) - 1] + (int(d) - 1 if d else 15)
    return y + doy / 365


def check_date(obj, where, field="date", inherit_precision=True):
    """A date must parse, sit inside the period, and agree with its `precision`.

    The precision rules encode the project's central worry — invented specificity:
      year  + a month/day  -> contradiction, hard error
      circa + a day        -> legal (a reported-but-disputed date) but must carry
                              an `uncertain` note saying who disagrees
      range                -> must be "YYYY/YYYY", earliest first
    """
    d = obj.get(field)
    if d in (None, ""):
        return
    d = str(d)
    p = obj.get("precision") if inherit_precision else None
    if p and p not in PRECISIONS:
        err(f"{where}: precision '{p}' not one of {sorted(PRECISIONS)}")

    # `range` covers two shapes that are semantically opposite, told apart by the
    # value itself:
    #   "YYYY/YYYY"        an uncertainty WINDOW around one moment (birth c.1165–70)
    #   a date + endDate   a known DURATION (a siege, a survey, a revolt)
    # Both are legitimate; conflating them would report a doubt as a duration.
    if "/" in d:
        m = re.match(rf"^({ONE_DATE})/({ONE_DATE})$", d)
        if not m:
            err(f"{where}: {field} '{d}' is not a <date>/<date> window")
            return
        a, b = m.group(1), m.group(2)
        if p != "range":
            err(f"{where}: {field} '{d}' is an uncertainty window but precision "
                f"is '{p}', not 'range'")
        if frac_year(a) >= frac_year(b):
            err(f"{where}: {field} window '{d}' is not earliest-first")
        for side in (a, b):
            y = year_of(side)
            if not (PERIOD[0] <= y <= PERIOD[1]):
                err(f"{where}: {field} year {y} outside {PERIOD[0]}–{PERIOD[1]}")
        return

    if not re.match(rf"^{ONE_DATE}$", d):
        extra = ""
        if re.search(r"[A-Za-z]", d):
            extra = " — prose belongs in `precision`/`uncertain`, not the date value"
        err(f"{where}: {field} '{d}' is not YYYY, YYYY-MM or YYYY-MM-DD{extra}")
        return
    y = year_of(d)
    if not (PERIOD[0] <= y <= PERIOD[1]):
        err(f"{where}: {field} year {y} outside {PERIOD[0]}–{PERIOD[1]}")
    parts = len(d.split("-"))
    if p == "day" and parts < 3:
        warn(f"{where}: precision 'day' but {field} '{d}' has no day")
    if p == "month" and parts != 2:
        warn(f"{where}: precision 'month' but {field} '{d}' is not YYYY-MM")
    if p == "year" and parts > 1:
        err(f"{where}: precision 'year' but {field} '{d}' asserts month/day — "
            f"false precision")


def check_circa_day(sub, where, uncertain):
    """`circa` at day granularity asserts a specific disputed date. That is a real
    historiographical move ("c. 24 December 1167, sources disagree") but it is only
    honest if the record says who disagrees."""
    if not isinstance(sub, dict):
        return
    d = str(sub.get("date") or "")
    if sub.get("precision") == "circa" and len(d.split("-")) == 3:
        if not str(uncertain or "").strip() and not str(sub.get("uncertain") or "").strip():
            err(f"{where}: precision 'circa' at day granularity ('{d}') needs an "
                f"`uncertain` note naming the disagreement")


def check_citations(cits, where, minimum=1):
    if not isinstance(cits, list) or len(cits) < minimum:
        err(f"{where}: needs >={minimum} citation(s), has "
            f"{len(cits) if isinstance(cits, list) else 0}")
        return
    for i, c in enumerate(cits):
        at = f"{where} cit[{i}]"
        if not isinstance(c, dict):
            err(f"{at}: not an object")
            continue
        url = c.get("url", "")
        if not re.match(r"^https?://", str(url)):
            err(f"{at}: url '{url}' is not http(s)")
        for f in ("title", "publisher", "quote"):
            if not str(c.get(f) or "").strip():
                err(f"{at}: '{f}' is empty")
        # The schema asks for <=240 chars. Overshooting is easy on a good long
        # primary-source sentence, so this warns rather than fails — but it warns,
        # because an unbounded "quote" starts becoming a paraphrase.
        q = str(c.get("quote") or "")
        if len(q) > 240:
            warn(f"{at}: quote is {len(q)} chars, over the 240 guideline")
        # A quote that is obviously a paraphrase of our own summary defeats the
        # point of quoting. Cheap heuristic: quotes should not be sentence-cased
        # restatements with no source-like texture. We only flag the empty case
        # above; deeper checks are the verification agents' job.


# ---------------------------------------------------------------- people

def validate_people(people):
    by_id = {}
    for p in people:
        pid = p.get("id")
        where = f"person '{pid}' ({p.get('_shard')})"
        if not pid or not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", str(pid)):
            err(f"{where}: id missing or not kebab-case")
            continue
        if pid in by_id:
            prev = by_id[pid]
            # Cross-shard duplicate: agents were told to reference, not author.
            # Keep the record with more citations and flag it.
            warn(f"person '{pid}' authored twice ({prev.get('_shard')} and "
                 f"{p.get('_shard')}) — keeping the better-cited record")
            keep = max(prev, p, key=lambda r: len(r.get("citations") or []))
            by_id[pid] = keep
            continue
        by_id[pid] = p

    for pid, p in by_id.items():
        where = f"person '{pid}'"
        if not str(p.get("name") or "").strip():
            err(f"{where}: name is empty")
        if not str(p.get("summary") or "").strip():
            err(f"{where}: summary is empty")
        check_citations(p.get("citations"), where, 1)
        # A monarch must rest on 2+ DISTINCT sources. Count across every citation array
        # on the record, not just the top-level one: a record citing royal.uk for the
        # reign and the Anglo-Saxon Chronicle for the death is well-sourced, and where
        # the citation happens to sit is a detail of the schema, not of the evidence.
        if p.get("monarch"):
            urls = {c.get("url") for c in (p.get("citations") or []) if isinstance(c, dict)}
            for sub in ("birth", "death", "reign"):
                s = p.get(sub)
                if isinstance(s, dict):
                    urls |= {c.get("url") for c in (s.get("citations") or [])
                             if isinstance(c, dict)}
            urls.discard(None)
            if len(urls) < 2:
                err(f"{where}: monarch rests on {len(urls)} distinct source(s); "
                    f"needs >=2")
        for f in ("birth", "death"):
            sub = p.get(f)
            if isinstance(sub, dict):
                check_date(sub, f"{where}.{f}")
                check_circa_day(sub, f"{where}.{f}", p.get("uncertain"))
                # A person's birth/death is a moment. `range` on it can only mean
                # an uncertainty window, so it must take the YYYY/YYYY form —
                # there is no endDate on a person to carry a duration.
                if sub.get("precision") == "range" and "/" not in str(sub.get("date") or ""):
                    err(f"{where}.{f}: precision 'range' on a person's "
                        f"{'birth' if f == 'birth' else 'death'} must be an "
                        f"uncertainty window ('YYYY/YYYY'), got '{sub.get('date')}'")
                if sub.get("date"):
                    check_citations(sub.get("citations"), f"{where}.{f}")
        if p.get("monarch"):
            r = p.get("reign")
            if not isinstance(r, dict) or not r.get("start"):
                err(f"{where}: monarch:true but no reign.start")
            else:
                check_date(r, f"{where}.reign", "start")
                check_date(r, f"{where}.reign", "end")
                check_citations(r.get("citations"), f"{where}.reign")
        b, d = year_of((p.get("birth") or {}).get("date")), \
               year_of((p.get("death") or {}).get("date"))
        if b and d:
            if d < b:
                err(f"{where}: dies {d} before born {b}")
            elif d - b > 105:
                warn(f"{where}: lifespan {d - b}y — implausible, check sources")
        # relationships
        for parent in p.get("parents") or []:
            if parent not in by_id:
                err(f"{where}: parent '{parent}' not in dataset")
            else:
                pb = year_of((by_id[parent].get("birth") or {}).get("date"))
                if pb and b and pb >= b:
                    err(f"{where}: parent '{parent}' born {pb} but child born {b}")
        for s in p.get("spouses") or []:
            if not isinstance(s, dict):
                err(f"{where}: spouse entry is not an object")
                continue
            if s.get("id") not in by_id:
                err(f"{where}: spouse '{s.get('id')}' not in dataset")
            check_date(s, f"{where}.spouse[{s.get('id')}]", "married")
            check_citations(s.get("citations"), f"{where}.spouse[{s.get('id')}]")
    return by_id


# ---------------------------------------------------------------- events

def validate_events(events, people):
    by_id = {}
    for e in events:
        eid = e.get("id")
        where = f"event '{eid}' ({e.get('_shard')})"
        if not eid or not re.match(r"^evt-\d{3,4}-[a-z0-9-]+$", str(eid)):
            err(f"{where}: id missing or not evt-<year>-<slug>")
            continue
        if eid in by_id:
            warn(f"event '{eid}' duplicated across shards — keeping first")
            continue
        by_id[eid] = e

    for eid, e in by_id.items():
        where = f"event '{eid}'"
        for f in ("title", "summary"):
            if not str(e.get(f) or "").strip():
                err(f"{where}: {f} is empty")
        check_date(e, where)
        check_circa_day(e, where, e.get("uncertain"))
        if not e.get("date"):
            err(f"{where}: date is required")
        # `range` on an event without the window form is a duration claim, and a
        # duration needs an end. Otherwise the UI has nothing to draw the span to.
        if e.get("precision") == "range" and "/" not in str(e.get("date") or "") \
                and not e.get("endDate"):
            err(f"{where}: precision 'range' asserts a duration but endDate is "
                f"missing (use 'YYYY/YYYY' if you meant an uncertainty window)")
        if e.get("endDate"):
            # endDate carries its own granularity; the event's `precision` describes
            # the start and must not be imposed on it.
            check_date({"date": e["endDate"]}, f"{where}.endDate",
                       inherit_precision=False)
            if year_of(e["endDate"]) and year_of(e.get("date")) and \
                    year_of(e["endDate"]) < year_of(e["date"]):
                err(f"{where}: endDate before date")
        # id year should match the date year — a mismatch means one of them is wrong
        idy = int(re.match(r"^evt-(\d{3,4})", eid).group(1))
        dy = year_of(e.get("date"))
        if dy and idy != dy:
            warn(f"{where}: id says {idy} but date says {dy}")
        if e.get("category") not in CATEGORIES:
            err(f"{where}: category '{e.get('category')}' not in {sorted(CATEGORIES)}")
        sig = e.get("significance")
        if not isinstance(sig, int) or not 1 <= sig <= 5:
            err(f"{where}: significance must be int 1–5, got {sig!r}")
        check_citations(e.get("citations"), where)
        for a in e.get("actors") or []:
            if a not in people:
                err(f"{where}: actor '{a}' not in people")
    return by_id


# ---------------------------------------------------------------- links

def validate_links(links, people, events):
    out = []
    seen = set()
    for i, l in enumerate(links):
        where = f"link[{i}] ({l.get('_shard')})"

        def endpoint(side):
            ref = l.get(side)
            if not isinstance(ref, dict):
                err(f"{where}: {side} is not an object")
                return False
            kind, rid = ref.get("kind"), ref.get("id")
            if kind == "person":
                if rid not in people:
                    err(f"{where}: {side} person '{rid}' not in people")
                    return False
            elif kind == "event":
                if rid not in events:
                    err(f"{where}: {side} event '{rid}' not in events")
                    return False
            elif kind == "edge":
                # "<a>--<b>" parent/child or "<a>~<b>" spouse
                sep = "--" if "--" in str(rid) else "~" if "~" in str(rid) else None
                if not sep:
                    err(f"{where}: {side} edge id '{rid}' malformed")
                    return False
                a, b = str(rid).split(sep, 1)
                missing = [x for x in (a, b) if x not in people]
                if missing:
                    err(f"{where}: {side} edge '{rid}' references unknown {missing}")
                    return False
                # the edge must actually exist in the genealogy
                if sep == "--":
                    if a not in (people[b].get("parents") or []):
                        err(f"{where}: edge '{rid}' claims {a} parents {b}, "
                            f"but people.json disagrees")
                        return False
                else:
                    sp = {s.get("id") for s in (people[a].get("spouses") or [])} | \
                         {s.get("id") for s in (people[b].get("spouses") or [])}
                    if b not in sp and a not in sp:
                        err(f"{where}: edge '{rid}' claims a marriage not in people.json")
                        return False
            else:
                err(f"{where}: {side}.kind '{kind}' invalid")
                return False
            return True

        ok = endpoint("from") and endpoint("to")
        if not ok:
            continue
        if not str(l.get("claim") or "").strip():
            err(f"{where}: claim is empty")
        if not re.match(r"^[a-z0-9]+(-[a-z0-9]+)*$", str(l.get("relation") or "")):
            err(f"{where}: relation '{l.get('relation')}' not kebab-case")
        if l.get("strength") not in STRENGTHS:
            err(f"{where}: strength '{l.get('strength')}' not in {sorted(STRENGTHS)}")
        check_citations(l.get("citations"), where)

        key = (l["from"]["kind"], l["from"]["id"], l["to"]["kind"], l["to"]["id"],
               l.get("relation"))
        if key in seen:
            warn(f"{where}: duplicate of an earlier link — dropped")
            continue
        seen.add(key)
        l["id"] = f"lnk-{len(out) + 1:03d}"
        out.append(l)
    return out


# ---------------------------------------------------------------- url liveness

def check_urls(records):
    urls = {}
    for r in records:
        for c in r.get("citations") or []:
            if isinstance(c, dict) and c.get("url"):
                urls.setdefault(c["url"], []).append(r.get("id"))
        for sub in ("birth", "death", "reign"):
            s = r.get(sub)
            if isinstance(s, dict):
                for c in s.get("citations") or []:
                    if isinstance(c, dict) and c.get("url"):
                        urls.setdefault(c["url"], []).append(r.get("id"))

    print(f"\nChecking {len(urls)} distinct citation URLs…")

    def probe(url):
        for method in ("HEAD", "GET"):
            try:
                req = urllib.request.Request(
                    url, method=method,
                    headers={"User-Agent": "Mozilla/5.0 (compatible; citation-check)"})
                with urllib.request.urlopen(req, timeout=25) as r:
                    return url, r.status, None
            except urllib.error.HTTPError as e:
                if method == "HEAD" and e.code in (403, 405, 501):
                    continue  # some hosts refuse HEAD; retry as GET
                return url, e.code, None
            except Exception as e:
                if method == "GET":
                    return url, None, type(e).__name__
        return url, None, "unreachable"

    bad = []
    with futures.ThreadPoolExecutor(max_workers=8) as ex:
        for url, status, exc in ex.map(probe, urls):
            if exc or (status and status >= 400):
                bad.append((url, status or exc, urls[url]))
    for url, why, ids in bad:
        err(f"dead citation URL [{why}] {url}  (cited by {', '.join(set(map(str, ids)))})")
    print(f"  {len(urls) - len(bad)}/{len(urls)} resolve")


# ---------------------------------------------------------------- main

def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--check-urls", action="store_true",
                    help="verify every citation URL resolves (slow, networked)")
    args = ap.parse_args()

    print("Loading shards…")
    people_raw = load_shards("people-*.json")
    events_raw = load_shards("events-*.json")
    links_raw = load_shards("links-*.json")

    if not people_raw or not events_raw:
        print("\nFATAL: people or events shards missing", file=sys.stderr)
        return 1

    apply_aliases(people_raw, events_raw, links_raw)

    people = validate_people(people_raw)
    events = validate_events(events_raw, people)
    links = validate_links(links_raw, people, events)

    if args.check_urls:
        check_urls(list(people.values()) + list(events.values()) + links)

    # strip internal bookkeeping
    def clean(r):
        return {k: v for k, v in r.items() if not k.startswith("_")}

    dataset = {
        "meta": {
            "title": "The Illuminated Succession",
            "range": [1042, 1422],
            "counts": {"people": len(people), "events": len(events),
                       "links": len(links)},
            "note": "Every claim carries a citation with a verbatim source quote. "
                    "`significance` on events is an editorial ranking; all other "
                    "fields are sourced.",
        },
        "people": [clean(p) for p in people.values()],
        "events": sorted((clean(e) for e in events.values()),
                         key=lambda e: (year_of(e["date"]) or 0, e["date"])),
        "links": [clean(l) for l in links],
    }

    print(f"\n{len(warnings)} warning(s):")
    for w in warnings:
        print(f"  ~ {w}")
    print(f"\n{len(errors)} error(s):")
    for e in errors:
        print(f"  ! {e}")

    if errors:
        print(f"\nFAILED — dataset not written. Fix the {len(errors)} error(s) above.",
              file=sys.stderr)
        return 1

    OUT.write_text(json.dumps(dataset, indent=1, ensure_ascii=False))
    m = dataset["meta"]["counts"]
    ncit = sum(len(r.get("citations") or [])
               for r in dataset["people"] + dataset["events"] + dataset["links"])
    print(f"\nOK -> {OUT}")
    print(f"  {m['people']} people, {m['events']} events, {m['links']} links, "
          f"{ncit} citations, {OUT.stat().st_size:,} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
