/**
 * CLI: fail if any Synthetics journey monitor name contains non-ASCII characters.
 *
 * Run: npm run check:journey-names
 *
 * Same env as `helpers/journeyNameAscii.ts`:
 * - JOURNEY_NAME_ASCII_ROOTS — comma-separated roots (default: journeys)
 * - JOURNEY_NAME_ASCII_CSVS — comma-separated CSVs for host columns / ${host}
 * - TLS_TARGET_HOSTS_CSV — single CSV if JOURNEY_NAME_ASCII_CSVS is unset
 */

import { collectJourneyNameViolations, formatJourneyNameViolation } from '../helpers/journeyNameAscii';

const root = process.cwd();
const violations = collectJourneyNameViolations(root);

if (violations.length > 0) {
  for (const v of violations) {
    console.error(formatJourneyNameViolation(v));
    if (v.fragment) {
      console.error(`  fragment: ${v.fragment}`);
    }
  }
  process.exit(1);
}

console.log('Journey monitor names are ASCII-only (no violations).');
