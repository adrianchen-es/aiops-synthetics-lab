/**
 * Static analysis for Elastic Synthetics `journey()` monitor names.
 *
 * Kibana monitor creation can fail when names contain non-ASCII punctuation
 * (for example U+2013 EN DASH "–" instead of U+002D HYPHEN-MINUS "-").
 * This module walks journey sources and ensures names are 7-bit ASCII only.
 *
 * ## Layout and CSV sources
 *
 * - Journey files are discovered **recursively** under each configured root
 *   (default: `journeys/`).
 * - Hostnames used to expand `` `...${host}...` `` in monitor names come from
 *   one or more CSV files (same schema as `parseTlsTargetHostsCsv`).
 *
 * Configure CSV paths (paths **relative to the project root**):
 *
 * - **`JOURNEY_NAME_ASCII_CSVS`** — comma-separated list; if set, this is the
 *   only source used by the ASCII checker.
 * - Else **`TLS_TARGET_HOSTS_CSV`** — single path (optional override).
 * - Else **every** localized `tls-target-hosts.csv` under `journeys/` (same discovery as
 *   `npm run generate:tls-targets` via `helpers/tlsTargetCsvDiscovery.ts`).
 *
 * Configure journey directories (relative to project root):
 *
 * - **`JOURNEY_NAME_ASCII_ROOTS`** — comma-separated list; if set, only these
 *   trees are scanned (e.g. `journeys/tls,journeys/demos`). If unset, default is
 *   `journeys`.
 */

import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, normalize, relative } from 'node:path';
import * as ts from 'typescript';
import { parseTlsTargetHostsCsv } from './loadTlsTargetHosts';
import { discoverTlsTargetHostCsvPathsRelativeToRoot } from './tlsTargetCsvDiscovery';

export type JourneyNameViolation = {
  /** Path relative to project root */
  file: string;
  line: number;
  column: number;
  message: string;
  /** Short excerpt for debugging */
  fragment: string;
};

/** Resolved options for `collectJourneyNameViolations`. */
export type JourneyNameAsciiConfig = {
  /**
   * Directories under `rootDir` to scan recursively for `*.journey.ts`.
   * Paths are relative to `rootDir` (e.g. `journeys`, `journeys/tls`).
   */
  journeyRoots: string[];
  /**
   * CSV files (relative to `rootDir`) whose `host` column is merged for
   * `${host}` template expansion and validated for ASCII. Use `[]` to skip CSV
   * checks (journeys that only use static monitor names).
   */
  hostCsvPaths: string[];
};

function firstNonAsciiIssue(s: string): string | null {
  for (let i = 0; i < s.length; ) {
    const cp = s.codePointAt(i)!;
    if (cp > 127) {
      const hex = cp.toString(16).toUpperCase().padStart(4, '0');
      return `non-ASCII U+${hex} (${JSON.stringify(s.slice(i, i + (cp > 0xffff ? 2 : 1)))})`;
    }
    i += cp > 0xffff ? 2 : 1;
  }
  return null;
}

function propertyNameText(name: ts.PropertyName): string | undefined {
  if (ts.isIdentifier(name)) {
    return name.text;
  }
  if (ts.isStringLiteral(name)) {
    return name.text;
  }
  return undefined;
}

/**
 * Default CSV paths for host expansion: same precedence as `generate:tls-targets`
 * plus optional multi-CSV list for additional journey folders.
 *
 * - `JOURNEY_NAME_ASCII_CSVS` — comma-separated relative paths (wins over all).
 * - Else `TLS_TARGET_HOSTS_CSV` — single relative path.
 * - Else all localized `tls-target-hosts.csv` files under `journeys/`.
 */
export function defaultHostCsvPathsFromEnv(rootDir: string = process.cwd()): string[] {
  const multi = process.env['JOURNEY_NAME_ASCII_CSVS'];
  if (multi !== undefined && multi.trim() !== '') {
    return multi
      .split(',')
      .map((s) => normalize(s.trim()))
      .filter((s) => s.length > 0);
  }
  const single = process.env['TLS_TARGET_HOSTS_CSV'];
  if (single !== undefined && single.trim() !== '') {
    return [normalize(single.trim())];
  }
  return discoverTlsTargetHostCsvPathsRelativeToRoot(rootDir);
}

/**
 * Default journey scan roots under `rootDir`.
 *
 * - `JOURNEY_NAME_ASCII_ROOTS` — comma-separated (e.g. `journeys/tls,journeys/demos`).
 * - Else `journeys`.
 */
export function defaultJourneyRootsFromEnv(): string[] {
  const raw = process.env['JOURNEY_NAME_ASCII_ROOTS'];
  if (raw !== undefined && raw.trim() !== '') {
    return raw
      .split(',')
      .map((s) => normalize(s.trim()))
      .filter((s) => s.length > 0);
  }
  return ['journeys'];
}

export function defaultJourneyNameAsciiConfig(rootDir: string = process.cwd()): JourneyNameAsciiConfig {
  return {
    journeyRoots: defaultJourneyRootsFromEnv(),
    hostCsvPaths: defaultHostCsvPathsFromEnv(rootDir),
  };
}

function readHostsFromCsvs(rootDir: string, csvRelPaths: string[]): {
  mergedHosts: string[];
  violations: JourneyNameViolation[];
} {
  const violations: JourneyNameViolation[] = [];
  const mergedHosts: string[] = [];

  for (const rel of csvRelPaths) {
    const abs = join(rootDir, rel);
    if (!existsSync(abs)) {
      violations.push({
        file: rel,
        line: 0,
        column: 0,
        message: `CSV not found (needed for host column validation and \${host} expansion): ${rel}`,
        fragment: rel,
      });
      continue;
    }
    const raw = readFileSync(abs, 'utf8');
    const rows = parseTlsTargetHostsCsv(raw);
    for (const row of rows) {
      mergedHosts.push(row.host);
      const issue = firstNonAsciiIssue(row.host);
      if (issue) {
        violations.push({
          file: rel,
          line: 0,
          column: 0,
          message: `TLS target host contains ${issue} (used in dynamic journey names)`,
          fragment: row.host,
        });
      }
    }
  }

  return { mergedHosts, violations };
}

/**
 * Lists every `*.journey.ts` file under each root (recursive).
 * Exported for tests and tooling.
 */
export function listJourneySourcePaths(rootDir: string, journeyRoots: string[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();

  const walk = (dir: string) => {
    let names: string[];
    try {
      names = readdirSync(dir);
    } catch {
      return;
    }
    for (const name of names) {
      const p = join(dir, name);
      let st;
      try {
        st = statSync(p);
      } catch {
        continue;
      }
      if (st.isDirectory()) {
        walk(p);
      } else if (name.endsWith('.journey.ts')) {
        const abs = p;
        if (!seen.has(abs)) {
          seen.add(abs);
          out.push(abs);
        }
      }
    }
  };

  for (const rel of journeyRoots) {
    const base = join(rootDir, rel);
    if (!existsSync(base)) {
      continue;
    }
    walk(base);
  }

  return out;
}

function expandTemplateMonitorNames(
  tpl: ts.TemplateExpression,
  hostValues: readonly string[],
  sourceFile: ts.SourceFile,
  relPath: string
): JourneyNameViolation[] {
  const violations: JourneyNameViolation[] = [];
  const pos = tpl.getStart(sourceFile);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);

  const push = (message: string, fragment: string) => {
    violations.push({
      file: relPath,
      line: line + 1,
      column: character,
      message,
      fragment,
    });
  };

  const checkStatic = (text: string, label: string) => {
    const issue = firstNonAsciiIssue(text);
    if (issue) {
      push(`Journey name template ${label} contains ${issue}`, text);
    }
  };

  checkStatic(tpl.head.text, 'prefix');

  let variants: string[] = [tpl.head.text];

  for (const span of tpl.templateSpans) {
    checkStatic(span.literal.text, 'literal segment');

    let replacements: string[];
    if (ts.isIdentifier(span.expression) && span.expression.text === 'host') {
      replacements = [...hostValues];
    } else {
      push(
        `Unsupported interpolation in journey name (only \${host} is analysed): ${span.expression.getText(sourceFile)}`,
        span.expression.getText(sourceFile)
      );
      replacements = [''];
    }

    const next: string[] = [];
    for (const prefix of variants) {
      for (const r of replacements) {
        next.push(prefix + r + span.literal.text);
      }
    }
    variants = next;
  }

  for (const resolved of variants) {
    const issue = firstNonAsciiIssue(resolved);
    if (issue) {
      push(`Resolved journey name contains ${issue}`, resolved);
    }
  }

  return violations;
}

function checkNameInitializer(
  init: ts.Expression,
  hostValues: readonly string[],
  sourceFile: ts.SourceFile,
  relPath: string
): JourneyNameViolation[] {
  const violations: JourneyNameViolation[] = [];
  const pos = init.getStart(sourceFile);
  const { line, character } = sourceFile.getLineAndCharacterOfPosition(pos);

  const push = (message: string, fragment: string) => {
    violations.push({
      file: relPath,
      line: line + 1,
      column: character,
      message,
      fragment,
    });
  };

  if (ts.isStringLiteral(init) || ts.isNoSubstitutionTemplateLiteral(init)) {
    const text = init.text;
    const issue = firstNonAsciiIssue(text);
    if (issue) {
      push(`Journey name contains ${issue}`, text);
    }
    return violations;
  }

  if (ts.isTemplateExpression(init)) {
    return expandTemplateMonitorNames(init, hostValues, sourceFile, relPath);
  }

  push(
    `Journey name is not a string or template literal (cannot validate): SyntaxKind.${ts.SyntaxKind[init.kind]}`,
    init.getText(sourceFile)
  );
  return violations;
}

function visitJourneyCall(
  node: ts.CallExpression,
  hostValues: readonly string[],
  sourceFile: ts.SourceFile,
  relPath: string
): JourneyNameViolation[] {
  const violations: JourneyNameViolation[] = [];
  const arg0 = node.arguments[0];
  if (!arg0) {
    violations.push({
      file: relPath,
      line: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).line + 1,
      column: sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile)).character,
      message: 'journey() call has no arguments',
      fragment: node.getText(sourceFile).slice(0, 80),
    });
    return violations;
  }

  if (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0)) {
    return checkNameInitializer(arg0, hostValues, sourceFile, relPath);
  }

  if (ts.isObjectLiteralExpression(arg0)) {
    for (const prop of arg0.properties) {
      if (!ts.isPropertyAssignment(prop)) {
        continue;
      }
      const key = propertyNameText(prop.name);
      if (key !== 'name') {
        continue;
      }
      violations.push(...checkNameInitializer(prop.initializer, hostValues, sourceFile, relPath));
    }
    return violations;
  }

  violations.push({
    file: relPath,
    line: sourceFile.getLineAndCharacterOfPosition(arg0.getStart(sourceFile)).line + 1,
    column: sourceFile.getLineAndCharacterOfPosition(arg0.getStart(sourceFile)).character,
    message: 'journey() first argument is not a string literal or { name: ... } object',
    fragment: arg0.getText(sourceFile).slice(0, 120),
  });
  return violations;
}

function walkSourceFile(sf: ts.SourceFile, hostValues: readonly string[], relPath: string): JourneyNameViolation[] {
  const out: JourneyNameViolation[] = [];

  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === 'journey'
    ) {
      out.push(...visitJourneyCall(node, hostValues, sf, relPath));
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return out;
}

/**
 * Returns violations for any `journey()` monitor name that is not entirely
 * 7-bit ASCII, plus TLS CSV hosts when used in `name: \`...${host}...\``.
 *
 * @param rootDir - Project root (defaults to `process.cwd()`).
 * @param config - Optional; merged with defaults from env via `defaultJourneyNameAsciiConfig(rootDir)`
 *   when properties are omitted. Pass `{ hostCsvPaths: [] }` to disable CSV/host checks.
 */
export function collectJourneyNameViolations(
  rootDir: string = process.cwd(),
  config?: Partial<JourneyNameAsciiConfig>
): JourneyNameViolation[] {
  const defaults = defaultJourneyNameAsciiConfig(rootDir);
  const journeyRoots =
    config?.journeyRoots !== undefined ? config.journeyRoots : defaults.journeyRoots;
  const hostCsvPaths =
    config?.hostCsvPaths !== undefined ? config.hostCsvPaths : defaults.hostCsvPaths;

  const { mergedHosts, violations: csvViolations } = readHostsFromCsvs(rootDir, hostCsvPaths);
  const violations: JourneyNameViolation[] = [...csvViolations];

  const hostValues = mergedHosts;

  for (const absPath of listJourneySourcePaths(rootDir, journeyRoots)) {
    const text = readFileSync(absPath, 'utf8');
    const sf = ts.createSourceFile(absPath, text, ts.ScriptTarget.Latest, true, ts.ScriptKind.TS);
    const rel = relative(rootDir, absPath);
    violations.push(...walkSourceFile(sf, hostValues, rel));
  }

  return violations;
}

export function formatJourneyNameViolation(v: JourneyNameViolation): string {
  const loc = v.line > 0 ? `${v.file}:${v.line}:${v.column + 1}` : v.file;
  return `${loc}: ${v.message}`;
}
