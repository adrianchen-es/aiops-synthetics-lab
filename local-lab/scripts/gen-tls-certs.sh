#!/usr/bin/env sh
# Generate a self-signed TLS server key + certificate in ../certs/
# Default validity: 1 day (override with DAYS=7, etc.).

set -eu
LAB_ROOT=$(cd "$(dirname "$0")/.." && pwd)
cd "$LAB_ROOT"
CONFIG="$LAB_ROOT/scripts/openssl-local.cnf"
CERT_DIR="$LAB_ROOT/certs"
DAYS="${DAYS:-1}"

mkdir -p "$CERT_DIR"

openssl req -x509 -newkey rsa:2048 -nodes \
  -keyout "$CERT_DIR/server.key" \
  -out "$CERT_DIR/server.crt" \
  -days "$DAYS" \
  -config "$CONFIG" \
  -extensions v3_req

chmod 600 "$CERT_DIR/server.key" 2>/dev/null || true
echo "Wrote $CERT_DIR/server.key and $CERT_DIR/server.crt (not_after: $(openssl x509 -in "$CERT_DIR/server.crt" -noout -enddate 2>/dev/null || true))"
