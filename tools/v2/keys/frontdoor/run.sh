#!/bin/sh
# Front-door view round: shots + target | game sheet, retried when Chrome fails to start (busy machine).
#   sh tools/v2/keys/frontdoor/run.sh <set> [shot.mjs options]
S=$1
shift
LOG=docs/v2/shots/house_front_nov19/$S.log
for i in 1 2 3; do
  perl -e 'alarm shift; exec @ARGV' 6000 node tools/v2/keys/frontdoor/shot.mjs --set "$S" "$@" > "$LOG" 2>&1
  if [ -f "docs/v2/shots/house_front_nov19/${S}_door.png" ]; then
    break
  fi
  echo "retry $i" >> "$LOG.retries"
done
tail -12 "$LOG"
