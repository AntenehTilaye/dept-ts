#!/usr/bin/env sh
# Wait until an HTTP endpoint answers 2xx.  scripts/wait-for.sh http://web:3000/api/health 120
set -eu
URL="$1"; TIMEOUT="${2:-60}"; i=0
until node -e "fetch('$URL').then(r=>process.exit(r.ok?0:1)).catch(()=>process.exit(1))"; do
  i=$((i+1)); [ "$i" -ge "$TIMEOUT" ] && { echo "timeout waiting for $URL"; exit 1; }
  sleep 1
done
echo "$URL is up"
