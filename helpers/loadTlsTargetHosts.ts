export type TlsTargetCriticality = 'critical' | 'high' | 'medium' | 'low';

export type TlsTargetHost = {
  host: string;
  criticality?: TlsTargetCriticality;
  /** When set with `assertionSelector`, step 2 in tls-browser asserts this text on that element. */
  assertionText?: string;
  assertionSelector?: string;
};

const ALLOWED: ReadonlySet<string> = new Set(['critical', 'high', 'medium', 'low']);

/**
 * Parses TLS monitor targets from CSV text (header
 * `host,criticality` or `host,criticality,assertionText,assertionSelector`).
 * `criticality` may be empty. Optional assertion columns are only used when both
 * are non-empty in the browser journey. Lines starting with `#` and blank lines are ignored.
 *
 * Used by `npm run generate:tls-targets` to build `helpers/tlsTargetHosts.<slug>.generated.ts`
 * for each localized `tls-target-hosts.csv` under `journeys/` (see `tlsTargetCsvDiscovery.ts`).
 * Journeys import that file so Elastic workers never read the CSV from disk.
 */
export function parseTlsTargetHostsCsv(raw: string): TlsTargetHost[] {
  const lines = raw
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter((l) => l.length > 0 && !l.startsWith('#'));

  if (lines.length === 0) {
    return [];
  }

  const rows: TlsTargetHost[] = [];
  let start = 0;
  const first = lines[0]!.toLowerCase();
  if (first.startsWith('host,')) {
    start = 1;
  }

  for (let i = start; i < lines.length; i++) {
    const line = lines[i]!;
    const comma = line.indexOf(',');
    if (comma < 0) {
      const host = line.trim();
      if (!host) {
        throw new Error(`Invalid CSV row in tls-target-hosts.csv (line ${i + 1}): ${line}`);
      }
      rows.push({ host });
      continue;
    }
    if (comma === 0) {
      throw new Error(`Invalid CSV row in tls-target-hosts.csv (line ${i + 1}): ${line}`);
    }
    const host = line.slice(0, comma).trim();
    const rest = line.slice(comma + 1);
    const tail = rest.split(',').map((f) => f.trim());
    const criticalityRaw = (tail[0] ?? '').toLowerCase();
    const assertionTextRaw = tail[1];
    const assertionSelectorRaw = tail[2];

    if (!host) {
      throw new Error(`Invalid host in tls-target-hosts.csv (line ${i + 1}): ${line}`);
    }

    let criticality: TlsTargetCriticality | undefined;
    if (criticalityRaw !== '') {
      if (!ALLOWED.has(criticalityRaw)) {
        throw new Error(
          `Invalid criticality in tls-target-hosts.csv (line ${i + 1}): ${line}`
        );
      }
      criticality = criticalityRaw as TlsTargetCriticality;
    }

    const assertionText =
      assertionTextRaw !== undefined && assertionTextRaw !== '' ? assertionTextRaw : undefined;
    const assertionSelector =
      assertionSelectorRaw !== undefined && assertionSelectorRaw !== ''
        ? assertionSelectorRaw
        : undefined;

    rows.push({ host, criticality, assertionText, assertionSelector });
  }

  return rows;
}
