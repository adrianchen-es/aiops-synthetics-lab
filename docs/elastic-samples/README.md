# Elastic: sample Workflows and alert queries

This directory pairs the **aiops-synthetics-lab** Synthetics project with [Elastic](https://www.elastic.co) **Workflows** and **Rules**, as used in the companion article *Automated Certificate Monitoring and Self-Healing* (Elastic Observability Labs, April 2026). **Think**-phase ES|QL and **Act**/**Verify**-phase Workflows in the article map to the files here.

**Query tuning:** the article’s main **ES|QL** example for approaching expiry uses **`NOW() + 90d > tls.server.x509.not_after`** (a 90-day look-ahead, matching the lab narrative). The checked-in query in [`alerts/01-certificate-approaching-30d-expiring.md`](alerts/01-certificate-approaching-30d-expiring.md) uses **`30d`** for a stricter, shorter window — change the date math in that file to match the article or your policy. The article also suggests a **tighter** rule (for example under 14 days) for **ACME**-style short-lived certs; treat these files as starting points.

Data in Synthetics comes from journeys using **`logCertInfo()`** and, for browser steps, the optional [ingest-pipeline-synthetics-browser.json](../ingest-pipeline-synthetics-browser.json) mapping to **`tls.server.*`**.

## Workflows (full definitions)

The files under **`workflows/`** are **complete workflow YAML** examples (triggers, steps, connectors, and ES|QL where used). You may need to adjust **index names**, **connectors**, **secrets**, and **Kibana/Elastic** version specifics before use.

| File | Summary |
|------|--------|
| [`workflows/01-smart-certificate-rotation-escalation-remediation.yaml`](workflows/01-smart-certificate-rotation-escalation-remediation.yaml) | **Smart Certificate Rotation — Escalation and Remediation:** alert-driven flow with severity mapping, business-hours logic, **Elasticsearch/ES|QL** host lookup, branching notifications, and optional **Ansible Tower**-style automation hooks. |
| [`workflows/02-canary-certificate-impact-check.yaml`](workflows/02-canary-certificate-impact-check.yaml) | **Canary certificate impact check:** manual inputs for target host/port, **Kibana** **osquery** **live query** to **`curl_certificate`**, ECS-style mapping to **`tls.server.x509.*`**, and follow-on impact steps for canary hosts. |

## Alerts: ES|QL in Markdown (`.md`)

The files under **`alerts/`** are **Markdown** with a single **fenced code block** (triple backticks) that holds the **[ES|QL](https://www.elastic.co/docs/explore-analyze/query-filter/languages/esql) query** only. There is no rule JSON, schedule, or connector YAML in the file—just the query, suitable to **copy into** Kibana **Rules** that accept **ES|QL** (or into **Discover** / **ES|QL** in Dev Tools for ad-hoc runs). You still set the **rule name**, **schedule**, **connectors**, and **grouping** in the stack UI.

| File | Query intent |
|------|----------------|
| [`alerts/01-certificate-approaching-30d-expiring.md`](alerts/01-certificate-approaching-30d-expiring.md) | **Certificate approaching 30-day expiry:** aggregate Synthetics **browser** documents with non-null **`tls.server.x509`**, compute **`days_until_expiry`**, and surface rows where the certificate is **inside 30 days of expiration** (`NOW() + 30d > not_after`) or has an invalid validity window (`not_before > NOW()`). **Adjust the `FROM` data sources** to your Synthetics / browser index pattern. |
| [`alerts/02-certificate-workflow-verification.md`](alerts/02-certificate-workflow-verification.md) | **Meta-alert (Verify / noise):** query **`.alerts-observability.*.alerts-*`** and count **repeated** fires of a rule named **`"Custom Certificate Expiry"`** (14-day lookback), grouped by **`tls.server.x509.subject.common_name`**. Set **`kibana.alert.rule.name`** to match the **display name** of the primary expiry rule you create in Kibana (name it however your runbooks require; the article’s flow assumes a single well-named **Think** rule to chain into **Act**). |

## Field and index hints

* After the **`synthetics-browser@custom`** ingest pipeline, use **`tls.server.x509`**, **`tls.server.hash`**, and related **`synthetics`**, **`monitor`**, and document fields in ES|QL as your mappings allow.
* Exact **data view / index** strings (`synthetics-*`, `logs-*`, `.alerts-*`) differ by version and project — always confirm in **Discover** before you promote a rule.

## Related project docs

* [Root README](../../README.md#kibana-tls-ui-and-synthetics-browsercustom-ingest-pipeline) (TLS UI + ingest)
* [local-lab](../../local-lab/README.md) (1-day self-signed certs, renew, fingerprint changes)
