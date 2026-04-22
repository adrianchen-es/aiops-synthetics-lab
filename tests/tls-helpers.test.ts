/**
 * Unit tests for helpers/tls.ts
 *
 * These tests cover the pure utility functions only — no network calls are
 * made, so they run reliably in CI without external connectivity.
 *
 * Run with:
 *   npm run test:unit
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeFingerprint } from '../helpers/tls';

// ─────────────────────────────────────────────────────────────────────────────
// computeFingerprint
// ─────────────────────────────────────────────────────────────────────────────

test('computeFingerprint: SHA-1 of empty buffer produces 40-char hex', () => {
  const result = computeFingerprint(Buffer.alloc(0), 'sha1');
  assert.equal(result.length, 40);
  assert.match(result, /^[0-9A-F]{40}$/);
});

test('computeFingerprint: SHA-256 of empty buffer produces 64-char hex', () => {
  const result = computeFingerprint(Buffer.alloc(0), 'sha256');
  assert.equal(result.length, 64);
  assert.match(result, /^[0-9A-F]{64}$/);
});

test('computeFingerprint: output is upper-cased', () => {
  const result = computeFingerprint(Buffer.from('hello'), 'sha1');
  assert.equal(result, result.toUpperCase());
});

test('computeFingerprint: SHA-1 of known input matches expected digest', () => {
  // SHA-1("") = da39a3ee5e6b4b0d3255bfef95601890afd80709
  const result = computeFingerprint(Buffer.alloc(0), 'sha1');
  assert.equal(result, 'DA39A3EE5E6B4B0D3255BFEF95601890AFD80709');
});

test('computeFingerprint: SHA-256 of known input matches expected digest', () => {
  // SHA-256("") = e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855
  const result = computeFingerprint(Buffer.alloc(0), 'sha256');
  assert.equal(
    result,
    'E3B0C44298FC1C149AFBF4C8996FB92427AE41E4649B934CA495991B7852B855'
  );
});

test('computeFingerprint: different buffers produce different digests', () => {
  const a = computeFingerprint(Buffer.from('hello'), 'sha256');
  const b = computeFingerprint(Buffer.from('world'), 'sha256');
  assert.notEqual(a, b);
});

test('computeFingerprint: same buffer always produces same digest', () => {
  const buf = Buffer.from('deterministic');
  const r1 = computeFingerprint(buf, 'sha256');
  const r2 = computeFingerprint(buf, 'sha256');
  assert.equal(r1, r2);
});
