# Journey folders

This layout matches the **aiops-synthetics-lab** companion to *Automated Certificate Monitoring and Self-Healing*: **browser** TLS + optional DOM checks live under **`tls-browser/`** (the article’s primary **Sense** path into `synthetics-*`), with **`tls/`** for TLS-only or route-stubbed checks.

Journeys are grouped by folder so you can **run** or **push** a subset without touching the rest.

## TLS CSV per folder

`npm run generate:tls-targets` scans **`journeys/`** recursively and writes one TypeScript module per **`tls-target-hosts.csv`**:

| CSV location | Generated module (do not edit) |
|--------------|-------------------------------|
| `tls/tls-target-hosts.csv` | `helpers/tlsTargetHosts.tls.generated.ts` |
| `tls-browser/tls-target-hosts.csv` | `helpers/tlsTargetHosts.tls-browser.generated.ts` |

Add a new group by creating **`journeys/<name>/tls-target-hosts.csv`** and journeys that import **`TLS_TARGET_HOSTS`** from **`../../helpers/tlsTargetHosts.<slug>.generated.ts`**, where `<slug>` matches the path under `journeys/` with `/` replaced by `.` (e.g. `my-team` → `tlsTargetHosts.my-team.generated.ts`).

The journey-name ASCII check (`npm run check:journey-names`) discovers the same CSV files automatically—no env vars required.

| Folder | Monitors | CSV-driven |
|--------|----------|------------|
| `tls/` | TLS certificate checks + generic TLS-only host | `tls/tls-target-hosts.csv` → `tlsTargetHosts.tls.generated.ts` |
| `tls-browser/` | Same TLS step as `tls/` plus real browser navigation (optional DOM assertions) | `tls-browser/tls-target-hosts.csv` (includes extra hosts such as `cloud.elastic.co` for [Elastic Cloud](https://cloud.elastic.co/)) |
| `demos/` | badssl.com demos (revoked cert, self-signed CA) | No |
| `kibana/` | Kibana login flow + TLS | No |

## Commands (see root `README.md`)

- **Run all journeys:** `npm test`
- **Run one group:** `npm run test:tls` · `npm run test:demos` · `npm run test:kibana`
- **Push all monitors:** `npm run push`
- **Push one group:** `npm run push:tls` · `npm run push:demos` · `npm run push:kibana`

After editing any **`tls-target-hosts.csv`**, run **`npm run generate:tls-targets`** (it runs automatically before `npm test`, `npm run test:dry`, and `npm run push`).
