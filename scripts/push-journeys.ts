/**
 * Invokes `elastic-synthetics push` with an optional --pattern so only journeys
 * under a named folder are uploaded. The CLI always scans from the repo root;
 * patterns limit which *.journey.* files are loaded.
 *
 * Usage: node --import tsx scripts/push-journeys.ts <group>
 * Groups: all | tls | demos | kibana
 * `tls` matches journeys/tls and journeys/tls-browser (shared TLS monitor groups).
 */

import { spawnSync } from 'node:child_process';

const root = process.cwd();
const group = process.argv[2] ?? 'all';

const patterns: Record<string, string | null> = {
  all: null,
  tls: '^journeys[\\\\/]tls(-browser)?[\\\\/].*\\.journey\\.(ts|js)$',
  demos: '^journeys[\\\\/]demos[\\\\/].*\\.journey\\.(ts|js)$',
  kibana: '^journeys[\\\\/]kibana[\\\\/].*\\.journey\\.(ts|js)$',
};

const pattern = patterns[group];
if (pattern === undefined) {
  console.error(`Unknown journey group "${group}". Use: ${Object.keys(patterns).join(' | ')}`);
  process.exit(1);
}

const args = ['elastic-synthetics', 'push', '--config', 'synthetics.config.ts', '-y'];
if (pattern) {
  args.push('--pattern', pattern);
}

const result = spawnSync('npx', args, { cwd: root, stdio: 'inherit', shell: true, env: process.env });
process.exit(result.status ?? 1);
