/**
 * Finds every `tls-target-hosts.csv` under the `journeys` tree (recursive).
 * Each directory that contains this file is treated as a self-contained TLS
 * monitor group; `npm run generate:tls-targets` emits one `helpers/tlsTargetHosts.<slug>.generated.ts` per file.
 */

import { existsSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

export const TLS_TARGET_HOSTS_CSV_BASENAME = 'tls-target-hosts.csv';

/**
 * Absolute paths to each matching CSV under `journeys/`.
 */
export function discoverTlsTargetHostCsvAbsPaths(journeysRoot: string): string[] {
  const found: string[] = [];

  function walk(dir: string) {
    if (!existsSync(dir)) {
      return;
    }
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (!st.isDirectory()) {
        continue;
      }
      const csvPath = join(p, TLS_TARGET_HOSTS_CSV_BASENAME);
      if (existsSync(csvPath)) {
        found.push(csvPath);
      }
      walk(p);
    }
  }

  walk(journeysRoot);
  return found;
}

/**
 * Paths relative to project root, POSIX-style (e.g. `journeys/tls/tls-target-hosts.csv`).
 */
export function discoverTlsTargetHostCsvPathsRelativeToRoot(rootDir: string): string[] {
  const journeysRoot = join(rootDir, 'journeys');
  return discoverTlsTargetHostCsvAbsPaths(journeysRoot).map((abs) =>
    relative(rootDir, abs).split(/[/\\]/).join('/')
  );
}

/**
 * Slug for generated filename: `journeys/tls` → `tls`, `journeys/foo/bar` → `foo.bar`.
 */
export function generatedModuleSlugForCsv(rootDir: string, csvAbsPath: string): string {
  const journeysRoot = join(rootDir, 'journeys');
  const dir = dirname(csvAbsPath);
  const rel = relative(journeysRoot, dir);
  if (!rel || rel.startsWith('..')) {
    throw new Error(`CSV must live under journeys/: ${csvAbsPath}`);
  }
  return rel.split(/[/\\]/).join('.');
}

export function generatedModuleBasename(slug: string): string {
  return `tlsTargetHosts.${slug}.generated`;
}
