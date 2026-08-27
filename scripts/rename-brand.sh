#!/usr/bin/env bash
# Rename the project brand across the whole repo.
#
#   ./scripts/rename-brand.sh <newname>        # dry run — shows what would change
#   ./scripts/rename-brand.sh <newname> --go   # actually rewrite
#
# ─────────────────────────────────────────────────────────────────────────────
# ⚠️  THE ONE THING THAT MAKES THIS SAFE
#
# "settle", "settled", "settles", "settling", "settlement(s)", "settleUp",
# "settlementId" are DOMAIN VOCABULARY, not the brand. Settling up a debt is the
# product's core concept — those words must survive the rename untouched.
#
# A naive s/settl/newname/ corrupts the entire ledger layer silently: it would
# turn `Settlement` into `NewnameEment`, break `settlementId` field names that
# Firestore documents are already keyed on, and rename `settleUp` callables.
#
# So every pattern below matches `settl` ONLY when it is NOT followed by `e`.
# That single lookahead is the difference between a 30-second rename and a
# multi-hour debugging session.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

NEW="${1:-}"
GO="${2:-}"

if [[ -z "$NEW" ]]; then
  echo "usage: $0 <newname> [--go]" >&2; exit 1
fi
if [[ ! "$NEW" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "ERROR: '$NEW' is not a valid Firebase project ID / npm scope." >&2
  echo "       Must be lowercase, 6-30 chars, start with a letter, [a-z0-9-] only." >&2
  exit 1
fi
# Capitalised display form: settl -> Settl
NEW_CAP="$(printf '%s' "${NEW:0:1}" | tr '[:lower:]' '[:upper:]')${NEW:1}"

# Competitor references in the clearance docs must NOT be renamed — they are
# evidence for why we left the name, and rewriting them destroys the record.
PROTECT=( "settl.fyi" "settlapp.in" "settl.company" )

files=$(grep -rlIPi 'settl(?!e)' . \
          --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
          --exclude-dir=coverage --exclude-dir=playwright-report \
          --exclude="rename-brand.sh" 2>/dev/null || true)

if [[ -z "$files" ]]; then echo "No brand occurrences found. Already renamed?"; exit 0; fi

if [[ "$GO" != "--go" ]]; then
  echo "DRY RUN — pass --go to apply. Renaming brand 'settl' -> '$NEW' ('$NEW_CAP')"
  echo
  echo "$files" | while read -r f; do
    n=$(grep -oIP 'settl(?!e)' "$f" 2>/dev/null | wc -l)
    printf "%4d  %s\n" "$n" "$f"
  done
  echo
  echo "Total files: $(echo "$files" | wc -l)"
  echo "Preserved untouched: settle / settled / settles / settling / settlement* / settleUp"
  echo "Preserved literals:  ${PROTECT[*]}"
  exit 0
fi

echo "Renaming 'settl' -> '$NEW' across $(echo "$files" | wc -l) files..."

echo "$files" | while read -r f; do
  # 1. park protected competitor literals behind placeholders
  i=0; for p in "${PROTECT[@]}"; do
    perl -pi -e "s/\Q$p\E/\x00PROTECT${i}\x00/g" "$f"; i=$((i+1))
  done

  # 2. the rename itself — every pattern guarded by (?!e)
  perl -pi -e "s/\@settl(?!e)\//\@$NEW\//g"   "$f"   # npm scope   @settl/core
  perl -pi -e "s/--settl(?!e)-/--$NEW-/g"     "$f"   # css vars    --settl-color-bg
  perl -pi -e "s/\bSettl(?!e)\b/$NEW_CAP/g"   "$f"   # display     Settl
  perl -pi -e "s/\bsettl(?!e)/$NEW/g"         "$f"   # everything else: settl-dev, settl-prod, allcottcourt1808/settl

  # 3. restore protected literals
  i=0; for p in "${PROTECT[@]}"; do
    perl -pi -e "s/\x00PROTECT${i}\x00/\Q$p\E/g" "$f"; i=$((i+1))
  done
done

echo "Done. Remaining (should be competitor references only):"
grep -rnIPi 'settl(?!e)' . --exclude-dir=.git --exclude-dir=node_modules --exclude="rename-brand.sh" 2>/dev/null || echo "  (none)"
echo
echo "STILL TO DO BY HAND:"
echo "  1. Rename the directory:  C:\Users\neeth\coding\settl  ->  ...\$NEW"
echo "  2. Check docs/19-qa-log.md R6 still reads correctly as history."
echo "  3. Firebase project IDs are NOT reserved yet — reserve $NEW-dev / $NEW-prod in Phase 02."
