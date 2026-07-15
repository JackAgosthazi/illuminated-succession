#!/usr/bin/env python3
"""One-off corrections where a researcher's PRECISION LABEL contradicted their own
prose, or reached for `range` because the schema then had no `after`/`before`.

Every fix below is a relabelling, not a change to any fact: the date values and the
citations are the researchers'. Each is justified verbatim from that record's own
`uncertain` note or citation quote, quoted in the comment. Nothing here invents,
narrows, or widens a claim.

Idempotent — safe to re-run. Run: python3 build/fix-precision.py
"""

import json
import pathlib
import sys

ROOT = pathlib.Path(__file__).parent.parent
SHARDS = ROOT / "data" / "shards"

# (person id, field, new date value, new precision, why)
FIXES = [
    # "Agatha (before 1030 – after 1070)" — the quote states bounds, not a window.
    ("agatha-exile", "birth", "1030", "before",
     'citation quote: "Agatha (before 1030 - after 1070)"'),
    ("agatha-exile", "death", "1070", "after",
     'citation quote: "Agatha (before 1030 - after 1070)"'),

    # 'the DNB states "17-18 June 1239"' — the day is unresolved between two, which is
    # a one-day uncertainty window, not a settled day and not a duration.
    ("edward-i", "birth", "1239-06-17/1239-06-18", "range",
     'uncertain note: sources give "17/18 June 1239" without resolving the day'),

    # 'Wikipedia gives only an open lower bound, "aft. 1333"'
    ("margaret-brabant", "death", "1333", "after",
     'uncertain note: Wikipedia gives only an open lower bound, "aft. 1333"'),

    # 'survives only as an upper bound, "before 8 July 1332"' — the bound itself was
    # being stored as a bare year, discarding the day the source actually gives.
    ("mary-woodstock", "death", "1332-07-08", "before",
     'uncertain note: "her death date survives only as an upper bound, before 8 July 1332"'),

    # '...before her burial at Westminster Abbey on 4 May 1379 or between 17 June and
    # 5 October 1382'. Two irreconcilable options; the honest reading is a window
    # spanning both, with the note carrying the detail.
    ("isabella-england", "death", "1379/1382", "range",
     'uncertain note: "the year may be 1379 or 1382"'),

    # 'places her death between about 1 October and 25 December 1361' — a real window;
    # only the year was being kept.
    ("margaret-england-1346", "death", "1361-10-01/1361-12-25", "range",
     'uncertain note: death placed "between about 1 October and 25 December 1361"'),
]

# (person id, spouse id, new married value, new precision, why)
SPOUSE_FIXES = [
    # Prose in a date field. The schema now carries `precision` on a spouse entry, so
    # "circa" survives as data rather than as an unparseable string.
    ("godwin-wessex", "gytha-thorkelsdottir", "1020", "circa", 'was "circa 1020"'),
    ("gytha-thorkelsdottir", "godwin-wessex", "1020", "circa", 'was "circa 1020"'),
    ("ealdgyth-mercia", "gruffydd-ap-llywelyn", "1057", "circa", 'was "circa 1057"'),
    # same marriage, recorded from the other side in a later shard
    ("gruffydd-ap-llywelyn", "ealdgyth-mercia", "1057", "circa", 'was "circa 1057"'),
]

# Scope corrections: `monarch: true` means "reigned as monarch of ENGLAND WITHIN this
# chart's 1042–1422 range". The app draws the gold succession thread by joining
# consecutive monarchs' reigns, so anyone flagged here lands on that thread.
#
# Æthelred reigned 978–1016, before the range starts. Left as monarch:true he sat on
# the thread at 978 with a 64-year leap straight to Edward the Confessor in 1042 —
# which draws a direct succession that never happened and silently erases Cnut,
# Harold I and Harthacnut. He belongs here as Edward's father, not as a monarch of
# this chart. This is the same rule already applied to Cnut, who ruled England but
# likewise predates 1042.
#
# (person id, role to set, why)
SCOPE_FIXES = [
    ("aethelred-unraed", "King of the English, 978–1013 and 1014–1016",
     "reigned before the 1042 start; on the succession thread he implied a direct "
     "handover to Edward the Confessor, erasing Cnut, Harold I and Harthacnut"),
]


def main() -> int:
    files = {p: json.loads(p.read_text()) for p in sorted(SHARDS.glob("people-*.json"))}
    index = {}
    for p, recs in files.items():
        for r in recs:
            index.setdefault(r["id"], []).append((p, r))

    applied, missing = 0, []

    for pid, field, date, prec, why in FIXES:
        if pid not in index:
            missing.append(pid)
            continue
        for _, r in index[pid]:
            sub = r.get(field)
            if not isinstance(sub, dict):
                continue
            if sub.get("date") == date and sub.get("precision") == prec:
                continue   # already applied
            print(f"  {pid}.{field}: {sub.get('date')!r}/{sub.get('precision')} "
                  f"-> {date!r}/{prec}\n      {why}")
            sub["date"] = date
            sub["precision"] = prec
            applied += 1

    for pid, sid, married, prec, why in SPOUSE_FIXES:
        if pid not in index:
            missing.append(pid)
            continue
        for _, r in index[pid]:
            for s in r.get("spouses") or []:
                if s.get("id") != sid:
                    continue
                if s.get("married") == married and s.get("precision") == prec:
                    continue
                print(f"  {pid}.spouse[{sid}].married: {s.get('married')!r} "
                      f"-> {married!r}/{prec}\n      {why}")
                s["married"] = married
                s["precision"] = prec
                applied += 1

    for pid, role, why in SCOPE_FIXES:
        if pid not in index:
            missing.append(pid)
            continue
        for _, r in index[pid]:
            if r.get("monarch") is False and r.get("role") == role:
                continue
            print(f"  {pid}: monarch {r.get('monarch')} -> False, role -> {role!r}\n"
                  f"      {why}")
            r["monarch"] = False
            # The reign object would be dead data on a non-monarch, and promoting it to
            # a `titles` entry would trip the REGNAL rule and draw a DASHED gold bar,
            # i.e. "disputed claim" — which his kingship was not. Record it in `role`.
            r["reign"] = None
            r["role"] = role
            applied += 1

    if missing:
        print(f"\nWARNING: not found, skipped: {sorted(set(missing))}", file=sys.stderr)

    if applied:
        for p, recs in files.items():
            p.write_text(json.dumps(recs, indent=1, ensure_ascii=False))
    print(f"\n{applied} fix(es) applied.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
