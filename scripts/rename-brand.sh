#!/usr/bin/env bash
# Rename the project brand across the whole repo.
#
#   ./scripts/rename-brand.sh <newname>                     # dry run
#   ./scripts/rename-brand.sh <newname> --go                # apply
#   ./scripts/rename-brand.sh <newname> --display=NewName   # custom display capitalisation
#   ./scripts/rename-brand.sh <newname> --from=oldbrand     # rename from something else
#
# ─────────────────────────────────────────────────────────────────────────────
# WHY THIS IS A SCRIPT AND NOT A FIND-AND-REPLACE
#
# A brand name can overlap the product's own domain vocabulary — settle, settled,
# settlement, settlementId, settleUp are all core concepts here, and a brand that
# is a prefix of them cannot be swapped with a plain substitution. That has already
# happened on this repo: the replacement rewrote `Settlement` mid-word and broke
# Firestore field names that documents were already keyed on — silently, and in a
# way that passes review.
#
# The guard for that is --guard=e, which makes every pattern match the old brand
# only when it is NOT followed by 'e'. The current brand does not collide with
# anything, so no guard is applied by default. If you ever rename TO a word that
# is a prefix of domain vocabulary, set it again.
#
# TWO THINGS THIS DELIBERATELY WILL NOT RENAME
#
#   * anything listed in PROTECT below — other companies' names and domains.
#     A sweep that rewrites one turns a reference to somebody else into a claim
#     about ourselves. That has already happened once here. The list is empty
#     today; add to it before any sweep that could reach such a literal.
# ─────────────────────────────────────────────────────────────────────────────

set -euo pipefail

NEW=""; GO=""; DISPLAY=""; FROM="splitsutra"; FROM_DISPLAY="SplitSutra"; GUARD=""
for arg in "$@"; do
  case "$arg" in
    --go)         GO="--go" ;;
    --display=*)  DISPLAY="${arg#--display=}" ;;
    --from=*)         FROM="${arg#--from=}"; FROM_DISPLAY="" ;;
    --from-display=*) FROM_DISPLAY="${arg#--from-display=}" ;;
    --guard=*)    GUARD="${arg#--guard=}" ;;
    -*)           echo "unknown flag: $arg" >&2; exit 1 ;;
    *)            [[ -z "$NEW" ]] && NEW="$arg" ;;
  esac
done

if [[ -z "$NEW" ]]; then
  echo "usage: $0 <newname> [--go] [--display=Name] [--from=old] [--from-display=Old] [--guard=e]" >&2; exit 1
fi
if [[ ! "$NEW" =~ ^[a-z][a-z0-9-]{4,28}[a-z0-9]$ ]]; then
  echo "ERROR: '$NEW' is not a valid Firebase project ID / npm scope." >&2
  echo "       Lowercase, 6-30 chars, must start with a letter, [a-z0-9-] only." >&2
  exit 1
fi

# Display form. Derived as ucfirst unless given, because a multi-word brand
# (SplitSutra) cannot be derived from its lowercase identifier (splitsutra).
if [[ -n "$DISPLAY" ]]; then
  NEW_CAP="$DISPLAY"
else
  NEW_CAP="$(printf '%s' "${NEW:0:1}" | tr '[:lower:]' '[:upper:]')${NEW:1}"
fi

# The OLD display form cannot be derived either: ucfirst("splitsutra") is "Splitsutra",
# which does not match the "SplitSutra" actually written in the files. Getting this wrong
# makes the rename silently skip every display-name occurrence.
if [[ -n "$FROM_DISPLAY" ]]; then
  FROM_CAP="$FROM_DISPLAY"
else
  FROM_CAP="$(printf '%s' "${FROM:0:1}" | tr '[:lower:]' '[:upper:]')${FROM:1}"
fi
LOOK=""
[[ -n "$GUARD" ]] && LOOK="(?!$GUARD)"

PROTECT=()

files=$(grep -rlIPi "$FROM$LOOK" . \
          --exclude-dir=.git --exclude-dir=node_modules --exclude-dir=dist \
          --exclude-dir=coverage --exclude-dir=playwright-report \
          --exclude="rename-brand.sh" 2>/dev/null || true)

if [[ -z "$files" ]]; then echo "No occurrences of '$FROM' found. Already renamed?"; exit 0; fi

if [[ "$GO" != "--go" ]]; then
  echo "DRY RUN — pass --go to apply."
  echo "  '$FROM' -> '$NEW'   (display: '$FROM_CAP' -> '$NEW_CAP')"
  echo
  [[ -n "$GUARD" ]] && echo "  guard: matches only when NOT followed by '$GUARD'"
  echo
  echo "$files" | while read -r f; do
    n=$(grep -oIPi "$FROM$LOOK" "$f" 2>/dev/null | wc -l)
    printf "%4d  %s\n" "$n" "$f"
  done
  echo
  echo "Total files: $(echo "$files" | wc -l)"
  echo "Never touched: ${#PROTECT[@]} protected literal(s)"
  exit 0
fi

echo "Renaming '$FROM' -> '$NEW' across $(echo "$files" | wc -l) files..."

echo "$files" | while read -r f; do
  [ -f "$f" ] || continue
  i=0; for p in "${PROTECT[@]}"; do
    perl -pi -e "s/\Q$p\E/\x00PROTECT${i}\x00/g" "$f"; i=$((i+1))
  done

  perl -pi -e "s/\@$FROM$LOOK\//\@$NEW\//g"     "$f"   # npm scope
  perl -pi -e "s/--$FROM$LOOK-/--$NEW-/g"       "$f"   # css custom properties
  perl -pi -e "s/\b$FROM_CAP$LOOK\b/$NEW_CAP/g" "$f"   # display name
  perl -pi -e "s/\b$FROM$LOOK/$NEW/g"           "$f"   # identifiers, ids, paths

  i=0; for p in "${PROTECT[@]}"; do
    perl -pi -e "s/\x00PROTECT${i}\x00/$p/g" "$f"; i=$((i+1))
  done
done

echo "Done. Remaining occurrences:"
grep -rnIPi "$FROM$LOOK" . --exclude-dir=.git --exclude-dir=node_modules \
  --exclude="rename-brand.sh" 2>/dev/null || echo "  (none)"
echo
echo "STILL TO DO BY HAND:"
echo "  1. Rename the checkout directory to '$NEW'."
echo "  2. Reserve $NEW-dev / $NEW-prod in Phase 02. Project IDs are permanent."
