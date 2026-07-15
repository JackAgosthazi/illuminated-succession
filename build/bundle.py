#!/usr/bin/env python3
"""Inline fonts, styles, data and script into one self-contained page.

No bundler: esbuild is unusable in this environment, and the page has no dependency
graph worth one. The source IS real ES modules — separate, individually readable,
each with a single job — but a published Artifact is one HTML file under a CSP that
blocks every external host, so `import` from a sibling file could never resolve.

So we concatenate: MODULES lists the files in dependency order, we strip the
import/export syntax, and the result runs in one shared scope. That is the same
thing a bundler does for a single-scope output, minus 40MB of node_modules.

Because the modules share one scope after concatenation, top-level names must be
unique ACROSS modules. `check_collisions` enforces that, so a duplicate `const`
fails the build here rather than silently breaking the page.

Run: python3 build/bundle.py [--preview]
"""

import argparse
import json
import pathlib
import re
import sys

ROOT = pathlib.Path(__file__).parent.parent
SRC = ROOT / "src"
OUT = ROOT / "dist" / "index.html"

# Dependency order. Nothing here may import anything later in the list.
MODULES = [
    "dates.js",
    "config.js",
    "model.js",
    "layout.js",
    "scene.js",
    "position.js",
    "gloss.js",
    "select.js",
    "controls.js",
    "main.js",
]

IMPORT_RE = re.compile(r"^\s*import\s+[^;]*?;\s*$", re.M)
EXPORT_FROM_RE = re.compile(r"^\s*export\s+\{[^}]*\}\s*(from\s+[^;]*)?;\s*$", re.M)
EXPORT_DECL_RE = re.compile(r"^(\s*)export\s+(?=(?:default\s+)?(?:const|let|var|function|class|async))", re.M)

DECL_RE = re.compile(
    r"^(?:export\s+)?(?:async\s+)?(?:const|let|var|function|class)\s+([A-Za-z_$][\w$]*)", re.M)


def strip_module_syntax(src: str) -> str:
    src = IMPORT_RE.sub("", src)
    src = EXPORT_FROM_RE.sub("", src)
    src = EXPORT_DECL_RE.sub(r"\1", src)
    return src


def check_collisions(sources: dict[str, str]) -> list[str]:
    """Top-level declarations must be unique across modules once concatenated."""
    seen: dict[str, str] = {}
    clashes = []
    for name, src in sources.items():
        # only top-level: lines with no leading whitespace
        for m in DECL_RE.finditer(src):
            if m.group(0)[0] in " \t":
                continue
            ident = m.group(1)
            if ident in seen:
                clashes.append(f"'{ident}' declared in both {seen[ident]} and {name}")
            else:
                seen[ident] = name
    return clashes


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--preview", action="store_true",
                    help="bundle data/dataset.preview.json instead of the validated dataset")
    args = ap.parse_args()

    data_path = ROOT / "data" / ("dataset.preview.json" if args.preview else "dataset.json")
    if not data_path.exists():
        print(f"{data_path.name} missing — run build/merge.py first", file=sys.stderr)
        return 1

    sources = {}
    for m in MODULES:
        p = SRC / m
        if not p.exists():
            print(f"module {m} missing", file=sys.stderr)
            return 1
        sources[m] = p.read_text()

    clashes = check_collisions(sources)
    if clashes:
        print("top-level name collisions across modules (they share one scope "
              "after bundling):", file=sys.stderr)
        for c in clashes:
            print(f"  ! {c}", file=sys.stderr)
        return 1

    app = "\n".join(
        f"// ══════════════════════════ src/{m} ══════════════════════════\n"
        + strip_module_syntax(sources[m]).strip()
        for m in MODULES
    )
    # One IIFE so nothing leaks to window except the dataset the template sets.
    app = "(() => {\n'use strict';\n" + app + "\n})();"

    tpl = (SRC / "index.template.html").read_text()
    data = json.loads(data_path.read_text())
    data_js = json.dumps(data, separators=(",", ":"), ensure_ascii=False)
    # "</script>" inside a JSON string would close the tag early.
    data_js = data_js.replace("</", "<\\/")

    for token, value in [
        ("/*__FONTS__*/", (SRC / "fonts.css").read_text()),
        ("/*__STYLES__*/", (SRC / "styles.css").read_text()),
        ("/*__DATA__*/null", data_js),
        ("/*__APP__*/", app),
    ]:
        if token not in tpl:
            print(f"template is missing token {token}", file=sys.stderr)
            return 1
        tpl = tpl.replace(token, value)

    OUT.parent.mkdir(parents=True, exist_ok=True)
    OUT.write_text(tpl)

    c = data["meta"]["counts"]
    print(f"OK -> {OUT}  ({OUT.stat().st_size / 1024:,.0f} KB)"
          + ("   [PREVIEW DATA]" if args.preview else ""))
    print(f"  {len(MODULES)} modules, {c['people']} people, {c['events']} events, "
          f"{c['links']} correlations")
    return 0


if __name__ == "__main__":
    sys.exit(main())
