#!/usr/bin/env sh
# Issue a new 1-day certificate and restart the running local TLS container(s)
# so HTTPS serves the new material (SHA-256 fingerprint and not_after change).

set -eu
LAB_ROOT=$(cd "$(dirname "$0")/.." && pwd)
export DAYS="${DAYS:-1}"
sh "$LAB_ROOT/scripts/gen-tls-certs.sh"
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^ac-synth-tls-nginx$'; then
  docker restart ac-synth-tls-nginx
  echo "Restarted ac-synth-tls-nginx (reload picked up new cert)."
fi
if docker ps --format '{{.Names}}' 2>/dev/null | grep -q '^ac-synth-tls-apache$'; then
  docker restart ac-synth-tls-apache
  echo "Restarted ac-synth-tls-apache (reload picked up new cert)."
fi
echo "Re-run Synthetics: the TLS cert fingerprint and expiry in Kibana/stdout should change."
