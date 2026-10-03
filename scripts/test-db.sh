#!/usr/bin/env bash
# Apply every migration to a throwaway local Postgres and run the RLS tests.
#   scripts/test-db.sh
# Needs Postgres 15+ server binaries (initdb/pg_ctl) on PATH or in /usr/lib/postgresql/*/bin.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
if ! command -v initdb >/dev/null; then
  PGBIN="$(ls -d /usr/lib/postgresql/*/bin 2>/dev/null | sort -V | tail -1 || true)"
  [ -n "$PGBIN" ] && export PATH="$PGBIN:$PATH"
fi
command -v initdb >/dev/null || { echo "initdb not found — install Postgres server binaries" >&2; exit 1; }

TMP="$(mktemp -d)"; PORT="${PGTEST_PORT:-54329}"
RUN_AS=(); [ "$(id -u)" = 0 ] && { chown -R postgres "$TMP"; RUN_AS=(runuser -u postgres --); }
cleanup() { "${RUN_AS[@]}" pg_ctl -D "$TMP/data" -m immediate stop >/dev/null 2>&1 || true; rm -rf "$TMP"; }
trap cleanup EXIT

"${RUN_AS[@]}" initdb -D "$TMP/data" -U postgres -A trust >/dev/null
"${RUN_AS[@]}" pg_ctl -D "$TMP/data" -o "-p $PORT -k $TMP -c listen_addresses='' -c wal_level=logical" -l "$TMP/log" -w start >/dev/null

PSQL=(psql -h "$TMP" -p "$PORT" -U postgres -d postgres -v ON_ERROR_STOP=1 -q -X)
"${PSQL[@]}" -f "$ROOT/supabase/tests/supabase_stub.sql"
for f in "$ROOT"/supabase/migrations/*.sql; do
  echo "migrate  $(basename "$f")"
  grep -v 'create extension if not exists pg_cron' "$f" | "${PSQL[@]}" >/dev/null
done
echo "test     rls.sql"
"${PSQL[@]}" -f "$ROOT/supabase/tests/rls.sql" 2>&1 >/dev/null | sed -E "s/^psql:[^ ]+ NOTICE:  //"
