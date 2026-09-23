#!/bin/sh
# Daily pg_dump of the app database with rotation. Runs as the `backup` service in
# docker-compose.yml (postgres:16-alpine, same major as `db`, so pg_dump matches the server).
#
#   /backups/daily/agile_metrics-YYYY-MM-DD.dump   last $KEEP_DAILY days
#   /backups/weekly/agile_metrics-YYYY-MM-DD.dump  copy taken on Sundays, last $KEEP_WEEKLY
#
# Custom format (-Fc): compressed, restorable with pg_restore (see docker/backup/restore.sh).
# Checks every 10 minutes and dumps once per day, at/after $BACKUP_HOUR local time ($TZ); also
# dumps on start if today's file is missing, so a host that was off at that hour still gets one.
# jira_cache is excluded: it's a rebuildable Jira cache and the bulk of the database size.
set -eu

BACKUP_HOUR="${BACKUP_HOUR:-3}"
KEEP_DAILY="${KEEP_DAILY:-7}"
KEEP_WEEKLY="${KEEP_WEEKLY:-4}"
DB="${PGDATABASE:?PGDATABASE must be set}"

mkdir -p /backups/daily /backups/weekly

prune() {
  # $1 = dir, $2 = how many to keep (newest by name, names sort chronologically)
  ls -1 "$1"/*.dump 2>/dev/null | sort -r | tail -n +"$(( $2 + 1 ))" | while read -r old; do
    rm -f "$old"
    echo "[backup] pruned $old"
  done
}

run_backup() {
  today="$(date +%F)"
  target="/backups/daily/${DB}-${today}.dump"
  tmp="${target}.partial"
  echo "[backup] $(date '+%F %T %Z') dumping ${DB} -> ${target}"
  # Write to a temp name first so a failed/interrupted dump never looks like a valid backup.
  if pg_dump -Fc --no-owner --exclude-table-data=jira_cache -f "$tmp" "$DB"; then
    mv "$tmp" "$target"
    echo "[backup] ok ($(du -h "$target" | cut -f1))"
    if [ "$(date +%u)" = "7" ]; then
      cp "$target" "/backups/weekly/${DB}-${today}.dump"
      echo "[backup] weekly copy saved"
    fi
    prune /backups/daily "$KEEP_DAILY"
    prune /backups/weekly "$KEEP_WEEKLY"
  else
    rm -f "$tmp"
    echo "[backup] FAILED - will retry on the next check" >&2
  fi
}

echo "[backup] started: daily at ${BACKUP_HOUR}:00 ${TZ:-UTC}, keep ${KEEP_DAILY} daily / ${KEEP_WEEKLY} weekly"
while true; do
  today_file="/backups/daily/${DB}-$(date +%F).dump"
  hour="$(date +%H | sed 's/^0//')"
  if [ ! -f "$today_file" ] && { [ "${hour:-0}" -ge "$BACKUP_HOUR" ] || [ "${FIRST_RUN_DONE:-0}" = "0" ]; }; then
    run_backup
  fi
  FIRST_RUN_DONE=1
  sleep 600
done
