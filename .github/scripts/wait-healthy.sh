#!/usr/bin/env bash
# Polls URL until it answers 2xx and, if given, its body contains EXPECT. Fails after TRIES attempts.
#   wait-healthy.sh <url> [expect-substring]      env: TRIES (default 30), DELAY seconds (default 10)
set -euo pipefail
url="$1"; expect="${2:-}"; tries="${TRIES:-30}"; delay="${DELAY:-10}"
for i in $(seq 1 "$tries"); do
  if body="$(curl -fsS --max-time 10 "$url" 2>/dev/null)"; then
    if [ -z "$expect" ] || grep -qF -- "$expect" <<<"$body"; then echo "healthy: $url (attempt $i)"; exit 0; fi
    echo "attempt $i: $url answered, but without the expected content yet"
  else
    echo "attempt $i: $url not healthy yet"
  fi
  [ "$i" -lt "$tries" ] && sleep "$delay"
done
echo "::error::$url did not become healthy after $tries attempts"
exit 1
