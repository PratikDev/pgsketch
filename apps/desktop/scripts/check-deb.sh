#!/usr/bin/env bash
# Installs the built .deb on clean Debian-based images, checks what it puts on the system, and
# starts the program as an ordinary user on a virtual display until it has logged that it started.
# Needs Docker. Usage: scripts/check-deb.sh [path/to/pgsketch.deb]
set -euo pipefail

deb=$(realpath "${1:-$(ls dist/pgsketch_*_amd64.deb)}")

for image in ubuntu:24.04 debian:12; do
  echo "== $image"
  # seccomp is off only because Docker's default profile stops Chromium making its sandbox
  docker run --rm --security-opt seccomp=unconfined -v "$deb:/pgsketch.deb:ro" "$image" bash -euo pipefail -c '
    apt-get update -qq >/dev/null 2>&1
    DEBIAN_FRONTEND=noninteractive apt-get install -y -qq /pgsketch.deb xvfb >/dev/null 2>&1
    test -x /opt/pgsketch/pgsketch
    test -f /usr/share/applications/pgsketch.desktop
    test -f /usr/share/icons/hicolor/512x512/apps/pgsketch.png && test -f /usr/share/icons/hicolor/48x48/apps/pgsketch.png
    useradd -m tester
    su tester -c "
      export PGSKETCH_DATA_DIR=/tmp/pgsketch-data
      xvfb-run -a /opt/pgsketch/pgsketch >/tmp/app.log 2>&1 &
      for _ in \$(seq 30); do
        grep -qs \"pgsketch started\" /tmp/pgsketch-data/main.log && exit 0
        sleep 1
      done
      cat /tmp/app.log
      exit 1
    "
  '
  echo "   installs and starts"
done
