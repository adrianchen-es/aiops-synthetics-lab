/**
 * Ensures Elastic Synthetics journey monitor names use 7-bit ASCII only.
 *
 * Non-ASCII punctuation (for example en dash U+2013) has caused Kibana monitor
 * creation to fail. Comments may still use Unicode; this test inspects the
 * TypeScript AST for `journey()` name arguments only.
 *
 * Configuration (for extra journey folders / CSVs) matches
 * `helpers/journeyNameAscii.ts` — see env vars `JOURNEY_NAME_ASCII_ROOTS`,
 * `JOURNEY_NAME_ASCII_CSVS`, and `TLS_TARGET_HOSTS_CSV`.
 *
 * Run with: npm run test:unit
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { join } from 'node:path';
import {
  collectJourneyNameViolations,
  defaultJourneyNameAsciiConfig,
  formatJourneyNameViolation,
  listJourneySourcePaths,
} from '../helpers/journeyNameAscii';

const root = join(__dirname, '..');

test('default: nested journeys/ and default TLS CSV produce no violations', () => {
  const violations = collectJourneyNameViolations(root);
  assert.equal(
    violations.length,
    0,
    violations.map((v) => formatJourneyNameViolation(v)).join('\n')
  );
});

test('default config discovers journey files under nested directories', () => {
  const cfg = defaultJourneyNameAsciiConfig(root);
  assert.ok(cfg.journeyRoots.includes('journeys'), 'expected default root journeys/');
  const paths = listJourneySourcePaths(root, cfg.journeyRoots);
  const rel = paths.map((p) => p.slice(root.length + 1).split(/[/\\]/).join('/'));
  assert.ok(
    rel.some((r) => r === 'journeys/tls/tls.journey.ts'),
    `expected journeys/tls/tls.journey.ts in ${rel.join(', ')}`
  );
  assert.ok(
    rel.some((r) => r === 'journeys/tls-browser/tls-browser.journey.ts'),
    `expected journeys/tls-browser/tls-browser.journey.ts in listing`
  );
  assert.ok(
    rel.some((r) => r === 'journeys/demos/badssl-revoked.journey.ts'),
    `expected demos journey in listing`
  );
});

test('explicit journeyRoots limits scan to a subdirectory (no false positives)', () => {
  const violations = collectJourneyNameViolations(root, {
    journeyRoots: ['journeys/kibana'],
    hostCsvPaths: [],
  });
  assert.equal(
    violations.length,
    0,
    violations.map((v) => formatJourneyNameViolation(v)).join('\n')
  );
});

test('explicit hostCsvPaths matches generate:tls-targets default CSV', () => {
  const tlsCsv = join('journeys', 'tls', 'tls-target-hosts.csv');
  const violations = collectJourneyNameViolations(root, {
    journeyRoots: [join('journeys', 'tls')],
    hostCsvPaths: [tlsCsv],
  });
  assert.equal(
    violations.length,
    0,
    violations.map((v) => formatJourneyNameViolation(v)).join('\n')
  );
});

test('bootstrap contract: default discovers every localized tls-target-hosts.csv under journeys/', () => {
  const cfg = defaultJourneyNameAsciiConfig(root);
  assert.ok(Array.isArray(cfg.journeyRoots));
  assert.ok(Array.isArray(cfg.hostCsvPaths));
  assert.ok(cfg.hostCsvPaths.length >= 2, 'expected tls + tls-browser localized CSVs');
  assert.ok(
    cfg.hostCsvPaths.some((p) => p.includes('/tls/tls-target-hosts.csv')),
    `expected tls csv, got ${cfg.hostCsvPaths.join(', ')}`
  );
  assert.ok(
    cfg.hostCsvPaths.some((p) => p.includes('tls-browser')),
    `expected tls-browser csv, got ${cfg.hostCsvPaths.join(', ')}`
  );
});
