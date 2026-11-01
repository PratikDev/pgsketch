#!/usr/bin/env bash
# A throwaway Postgres in Docker to point the dev app at. Usage: scripts/dev-db.sh up|load|down
#   up    starts it detached and waits until it takes connections
#   load  (re)creates the database `pgsketch` from packages/core/test/fixtures/basic.sql
#   down  stops and removes it (the data goes with it)
# Connect with host localhost, user postgres, password test, database pgsketch. PG_VERSION (default 16) and PG_PORT
# (default 5432) change the server.
set -euo pipefail

name=pgsketch-dev-pg
version=${PG_VERSION:-16}
port=${PG_PORT:-5432}
fixture="$(cd "$(dirname "$0")/../../.." && pwd)/packages/core/test/fixtures/basic.sql"
psql_in_container() { docker exec -i "$name" psql -U postgres -v ON_ERROR_STOP=1 "$@"; }

case "${1:-}" in
  up)
    if docker ps -q --filter "name=^$name$" | grep -q .; then
      echo "$name is already running on port $port"
      exit 0
    fi
    docker run -d --rm --name "$name" -e POSTGRES_PASSWORD=test -p "$port:5432" "postgres:$version" >/dev/null
    # the image starts a temporary server to set itself up and then the real one: wait for the second
    until [ "$(docker logs "$name" 2>&1 | grep -c 'ready to accept connections')" -ge 2 ]; do
      docker ps -q --filter "name=^$name$" | grep -q . || { echo "$name stopped at startup" >&2; exit 1; }
      sleep 1
    done
    printf 'Postgres %s is ready:\nlocalhost:%s\nuser postgres\npassword test\ndatabase pgsketch\n' "$version" "$port"
    ;;
  load)
    psql_in_container -q -c 'DROP DATABASE IF EXISTS pgsketch' -c 'CREATE DATABASE pgsketch'
    psql_in_container -q -d pgsketch <"$fixture"
    echo "Loaded basic.sql into the database pgsketch"
    ;;
  down)
    if docker ps -aq --filter "name=^$name$" | grep -q .; then
      docker rm -f "$name" >/dev/null
      echo "$name removed"
    else
      echo "$name was not running"
    fi
    ;;
  *)
    echo "Usage: $0 up|load|down" >&2
    exit 2
    ;;
esac
