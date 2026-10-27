#!/bin/sh
set -eu
if [ ! -s "$PGDATA/PG_VERSION" ]; then
  initdb -D "$PGDATA" --username=clone_admin --pwfile=/run/secrets/full_pg_password --auth-local=trust --auth-host=scram-sha-256 --encoding=UTF8 --locale=C.UTF-8
fi
# pg_net must be preloaded to restore its objects. Its worker is confined to
# the empty maintenance database, not the clone. The DB network has no egress.
exec postgres -D "$PGDATA" -c listen_addresses='*' -c hba_file=/clone/pg_hba.conf -c shared_preload_libraries='pg_stat_statements,pg_net' -c pg_net.database_name=postgres -c pg_net.username=clone_admin -c max_connections=50 -c timezone=UTC -c wal_level=logical
