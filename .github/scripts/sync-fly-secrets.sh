#!/usr/bin/env bash
# Copies runtime settings from the GitHub `production` environment into Fly secrets, staged, so the deploy
# that follows starts with them. GitHub is the one place these values are kept; Fly only receives copies.
#
# Inputs (environment):
#   REQUIRED   names that must be set in GitHub; the deploy stops if any is missing
#   OPTIONAL   names copied only when set (an empty value is never sent: it would fail the server's checks)
#   PROTECTED  names whose value must never change once the app has data (e.g. KEY_ENCRYPTION_KEY)
#   ALLOW_PROTECTED_CHANGE  "true" to accept a different value for a PROTECTED name (rotation, on purpose)
#   and one variable per name holding its value.
# Values are never printed. Names that are removed from GitHub are left as they are on Fly (never unset here).
set -euo pipefail
FLY="${FLYCTL:-flyctl}"

missing=()
for n in ${REQUIRED:-}; do [ -n "${!n:-}" ] || missing+=("$n"); done
if [ ${#missing[@]} -gt 0 ]; then
  echo "::error::Missing in the GitHub production environment: ${missing[*]}. Nothing was changed on Fly."
  exit 1
fi

# A changed KEY_ENCRYPTION_KEY makes every stored tenant key unreadable, so a protected value is compared
# with the one the running app has (by SHA-256, over fly ssh) before anything is staged.
existing="$($FLY secrets list --json 2>/dev/null | jq -r '.[] | (.Name // .name)' || true)"
for n in ${PROTECTED:-}; do
  [ -n "${!n:-}" ] || continue
  grep -qx "$n" <<<"$existing" || { echo "$n: not on Fly yet; it will be set."; continue; }
  want="$(printf %s "${!n}" | sha256sum | cut -d' ' -f1)"
  have="$($FLY ssh console -q -C "sh -c 'printf %s \"\$$n\" | sha256sum'" 2>/dev/null | grep -Eo '^[0-9a-f]{64}' | head -1 || true)"
  if [ "$have" = "$want" ]; then echo "$n: matches the running app."; continue; fi
  if [ "${ALLOW_PROTECTED_CHANGE:-false}" = "true" ]; then echo "::warning::$n will change (allowed by the run's input)."; continue; fi
  if [ -z "$have" ]; then
    echo "::error::$n is already on Fly and could not be compared (fly ssh failed or no machine is running). Re-run with allow_protected_change only if you are sure the GitHub value is the one in use."
  else
    echo "::error::$n in GitHub differs from the value the running app uses. Changing it breaks existing data. Copy the value in use into GitHub, or re-run with allow_protected_change to rotate on purpose."
  fi
  exit 1
done

lines=""
staged=()
for n in ${REQUIRED:-} ${OPTIONAL:-}; do
  v="${!n:-}"
  [ -n "$v" ] || continue
  case "$v" in *$'\n'*) echo "::error::$n contains a line break; Fly secrets import takes one line per value."; exit 1 ;; esac
  lines+="$n=$v"$'\n'
  staged+=("$n")
done
printf %s "$lines" | $FLY secrets import --stage
echo "Staged on Fly (values not shown): ${staged[*]}"
