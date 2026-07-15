#!/usr/bin/env bash
# Build, validate, and publish to GitHub Pages.
#
# merge.py is the gate: it exits non-zero if any claim is unsourced, any reference
# dangles, or any date claims more precision than its source gives. `set -e` means a
# failed validation stops the deploy — an invalid dataset must never reach the public
# URL.
#
# Usage: build/deploy.sh ["commit message"]
set -euo pipefail

cd "$(dirname "$0")/.."

echo "==> regenerating the id list from the current shards"
# Must run BEFORE researchers link against it. Generating this while a people agent was
# still mid-write once cost real correlations, because ids that existed looked absent.
python3 build/make-ids.py

echo "==> validating and merging shards"
python3 build/merge.py

echo "==> bundling"
python3 build/bundle.py

echo "==> staging for Pages"
cp dist/index.html docs/index.html

git add -A
if git diff --cached --quiet; then
  echo "==> nothing changed; not deploying"
  exit 0
fi

git -c user.name="Jack Agosthazi" -c user.email="jackagosthazi@anthropic.com" \
    commit -q -m "${1:-Rebuild dataset and page}

Co-Authored-By: Claude <noreply@anthropic.com>"
git push -q origin main

echo
echo "==> pushed. Pages rebuilds in ~1 min:"
echo "    https://jackagosthazi.github.io/illuminated-succession/"
