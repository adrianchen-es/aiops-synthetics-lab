# Local TLS lab: 1-day self-signed certs (Nginx / Apache)

This folder is optional automation for simulating **short certificate lifetimes**, **expiry failure**, and **rotate / re-notify** flows. It lines up with the **Verify** step in the article’s *Automated Certificate Monitoring and Self-Healing* loop: re-issue, restart the web server, and re-run Synthetics to see a **new fingerprint** and a valid `not_after` (see also **`docs/elastic-samples/workflows/02-canary-certificate-impact-check.yaml`** for Osquery canary-style checks in-cluster).

It is for lab use before you point production monitors at real services.

Each issued certificate is **self-signed** and, by default, **valid for one calendar day** (see `DAYS` below). Nginx and Apache are wired as two **Docker Compose profiles** that share the same `certs/server.crt` and `certs/server.key` files.

| Stack    | Command                         | URL on the host   |
|----------|---------------------------------|-------------------|
| Nginx    | `docker compose --profile nginx up -d`   | `https://127.0.0.1:8443` |
| Apache   | `docker compose --profile apache up -d`  | `https://127.0.0.1:8444` |

Pick one (or run both) — ports **8443** and **8444** map to HTTPS **443** inside the container, so you do not need a privileged **443** binding on your laptop.

## Prerequisites

- [Docker](https://docs.docker.com/get-docker/) with Compose
- [OpenSSL](https://www.openssl.org/) (the `openssl` command on your PATH; macOS and most Linux distros include it)
- A checkout of this repository

## 1. Issue a 1-day self-signed key pair

From **`local-lab/`**:

```bash
./scripts/gen-tls-certs.sh
```

- Writes **`certs/server.key`** and **`certs/server.crt`**.
- **Default:** `DAYS=1` (one day, including time-of-day; check with `openssl x509 -in certs/server.crt -noout -enddate`).

**Other validity (optional):** `DAYS=7 ./scripts/gen-tls-certs.sh`

The OpenSSL request config ([`scripts/openssl-local.cnf`](./scripts/openssl-local.cnf)) includes **SANs** for `localhost`, `tls-lab.test`, and `127.0.0.1` so the server name you pass to the TLS client can match the certificate when testing locally.

**Security:** do not re-use these files outside a lab. They are git-ignored (see repository `.gitignore`).

## 2. Start Nginx or Apache

Still from **`local-lab/`**:

**Nginx**

```bash
docker compose --profile nginx up -d
```

**Apache (builds a small image that enables `mod_ssl`)**

```bash
docker compose --profile apache up -d
```

**Sanity check**

```bash
# Nginx
curl -k https://127.0.0.1:8443/
# Apache
curl -k https://127.0.0.1:8444/
```

(`-k` skips server certificate verification; the cert is not public-CA–issued.)

Optional: add a hosts entry so you can use the DNS SAN:

```text
# /etc/hosts (or equivalent)
127.0.0.1  tls-lab.test
```

Then: `curl -k https://tls-lab.test:8443/` (Nginx).

## 3. Run a journey against the lab (Elastic Synthetics)

**Use the generic TLS monitor** so you can set **host** and **port** without editing CSV files: [`journeys/tls/tls-certificate.journey.ts`](../journeys/tls/tls-certificate.journey.ts).

`fetchCertInfo()` in this project uses `rejectUnauthorized: false` to read the leaf certificate for inspection, which is the right model for a self-signed lab target. `synthetics.config.ts` also sets `ignoreHTTPSErrors: true` so the Playwright navigation step in that journey can reach `https://…` for URL telemetry when the cert is not publicly trusted.

From the **repository root** (one example — Nginx on 8443):

**macOS / Linux**

```bash
TLS_TARGET_HOST=localhost TLS_TARGET_PORT=8443 npx @elastic/synthetics journeys/tls/tls-certificate.journey.ts
```

**Windows (PowerShell)**

```powershell
$env:TLS_TARGET_HOST="localhost"; $env:TLS_TARGET_PORT="8443"; npx @elastic/synthetics journeys/tls/tls-certificate.journey.ts
```

- Use **`127.0.0.1`** for `TLS_TARGET_HOST` if you prefer; the cert includes that IP in SAN.
- For **Apache**, set **`TLS_TARGET_PORT=8444`**.

> **Note:** the CSV-based journeys under `journeys/tls/tls.journey.ts` and `journeys/tls-browser/tls-browser.journey.ts` use port **443** and assert **OS trust** — they are a poor match for a self-signed lab. Prefer **`tls-certificate.journey.ts`** here.

## 4. Simulate expiry, renew, and notification-style workflows

| Goal | How |
|------|-----|
| **See a failing run (expired cert)** | Wait until the current `notAfter` is in the past, or leave the same cert on disk past its validity, then run the journey again. Step **"Verify certificate is not expired"** in `tls-certificate.journey.ts` should **fail** with a clear `validTo` vs `now` error. |
| **Rotate the certificate (renew) and get “green” again** | Re-issue and reload the web server: `./scripts/renew-tls-certs.sh` (see below). The **SHA-256** fingerprint in stdout / `logCertInfo` should **change** when the new key is generated. |
| **Notifications in Kibana / Elastic** | - Use **Synthetics** failure alerts (run failed) when the expiry step throws.<br> - If you use the [ingest pipeline](../docs/ingest-pipeline-synthetics-browser.json) for browser data, you can also build **rules** on `tls.server.x509.not_after` in **Discover** or **Rules** to warn **before** expiry (e.g. within 12 hours) using the `TLS_CERT` / `TLS_HASH` stdout that `logCertInfo` emits. |

**Renew script** (from **`local-lab/`**):

```bash
./scripts/renew-tls-certs.sh
```

This runs `gen-tls-certs.sh` with the default 1-day validity, then `docker restart`s **`ac-synth-tls-nginx`** and/or **`ac-synth-tls-apache`** if those containers are running, so the next HTTPS handshake serves the new material without rebuilding images.

**Push to Elastic (optional):** the same `TLS_TARGET_HOST` / `TLS_TARGET_PORT` values can be set on the monitor (for example as **params** in the Synthetics project / Kibana UI, depending on your stack version) so a **Private Location** or worker with network access to the lab can run the check — only do this on a safe, isolated network.

## 5. Stop the lab

From **`local-lab/`** (stop containers you started):

```bash
docker compose --profile nginx down
docker compose --profile apache down
```

---

### Files in this directory

| Path | Role |
|------|------|
| `docker-compose.yml` | Nginx and Apache services (Compose **profiles** `nginx` and `apache`) |
| `scripts/gen-tls-certs.sh` | OpenSSL: creates `certs/server.{key,crt}`; **`DAYS` default = 1** |
| `scripts/renew-tls-certs.sh` | Re-issues 1-day certs and restarts the lab containers if running |
| `scripts/openssl-local.cnf` | OpenSSL `req` config: CN + SANs |
| `nginx/default.conf` | TLS virtual host; plain response body for `curl` |
| `apache/Dockerfile` | Enables `mod_ssl`, copies `httpd-ssl.conf` |
| `apache/httpd-ssl.conf` | `Listen 443` + `VirtualHost` for TLS |
