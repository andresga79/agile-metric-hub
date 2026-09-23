#!/bin/sh
# Restore a backup produced by docker/backup/backup.sh.
#
#   docker/backup/restore.sh backups/daily/agile_metrics-2026-09-23.dump            # into the app DB
#   docker/backup/restore.sh backups/daily/agile_metrics-2026-09-23.dump test_copy  # into another DB
#
# Restoring into the app DB REPLACES its current contents (pg_restore --clean). Stop the api
# first (`docker compose stop api`) so it isn't writing mid-restore, then start it again; the
# Jira cache (not included in backups) refills on the next sync.
set -eu

FILE="${1:?usage: restore.sh <dump file> [target database]}"
[ -f "$FILE" ] || { echo "no such file: $FILE" >&2; exit 1; }

DB_USER="$(docker exec agile_metrics_db printenv POSTGRES_USER)"
APP_DB="$(docker exec agile_metrics_db printenv POSTGRES_DB)"
TARGET="${2:-$APP_DB}"

if [ "$TARGET" = "$APP_DB" ]; then
  printf 'This will REPLACE the contents of "%s" with %s. Type the database name to confirm: ' "$APP_DB" "$FILE"
  read -r answer
  [ "$answer" = "$APP_DB" ] || { echo "aborted"; exit 1; }
else
  docker exec agile_metrics_db createdb -U "$DB_USER" "$TARGET"
fi

docker exec -i agile_metrics_db pg_restore -U "$DB_USER" -d "$TARGET" --clean --if-exists --no-owner < "$FILE"
echo "restored $FILE into $TARGET"
