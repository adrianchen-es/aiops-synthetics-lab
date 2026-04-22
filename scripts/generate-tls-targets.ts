import { readFileSync, writeFileSync } from 'fs';
import { join, relative } from 'path';
import { parseTlsTargetHostsCsv } from '../helpers/loadTlsTargetHosts';
import {
  discoverTlsTargetHostCsvAbsPaths,
  generatedModuleBasename,
  generatedModuleSlugForCsv,
} from '../helpers/tlsTargetCsvDiscovery';

const root = process.cwd();
const journeysRoot = join(root, 'journeys');

const csvFiles = discoverTlsTargetHostCsvAbsPaths(journeysRoot);

if (csvFiles.length === 0) {
  console.warn(
    'No tls-target-hosts.csv found under journeys/. Add e.g. journeys/<group>/tls-target-hosts.csv'
  );
}

for (const csvPath of csvFiles) {
  const slug = generatedModuleSlugForCsv(root, csvPath);
  const outName = `${generatedModuleBasename(slug)}.ts`;
  const outPath = join(root, 'helpers', outName);
  const csvRel = relative(root, csvPath).split(/[/\\]/).join('/');

  const raw = readFileSync(csvPath, 'utf8');
  const rows = parseTlsTargetHostsCsv(raw);
  const serialized = JSON.stringify(rows, null, 2);

  const header = `/**
 * Generated from ${csvRel} — do not edit by hand.
 * Run: npm run generate:tls-targets
 *
 * One generated module per localized tls-target-hosts.csv under journeys/.
 */
import type { TlsTargetHost } from './loadTlsTargetHosts';

`;

  const file = `${header}export const TLS_TARGET_HOSTS: readonly TlsTargetHost[] = ${serialized};\n`;
  writeFileSync(outPath, file, 'utf8');
}
