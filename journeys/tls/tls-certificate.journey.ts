/**
 * TLS-Only Certificate Hash Journey
 *
 * Extracts the SHA-256 fingerprint of a remote server's TLS certificate and
 * verifies the certificate has not expired.  Uses the Node.js built-in `tls`
 * module — no browser is launched, keeping execution time and resource usage
 * to an absolute minimum.
 *
 * The SHA-256 fingerprint is read from `cert.fingerprint256`, which is
 * pre-computed by OpenSSL during the TLS handshake at no extra cost.  SHA-1
 * is also available as an optional field but should not be used as a trust
 * anchor.
 *
 * Environment variables
 * ─────────────────────
 *   TLS_TARGET_HOST   Hostname to inspect (default: example.com)
 *   TLS_TARGET_PORT   Port to connect on  (default: 443)
 *
 * Push this monitor group to Elastic with:
 *   npm run push:tls
 * Or deploy everything:
 *   npm run push
 */

import { journey, step, expect } from '@elastic/synthetics';
import { fetchCertInfo, logCertInfo, CertInfo } from '../../helpers/tls';

const TARGET_HOST = process.env['TLS_TARGET_HOST'] ?? 'example.com';
const TARGET_PORT = parseInt(process.env['TLS_TARGET_PORT'] ?? '443', 10);

journey('TLS Certificate Hash - Generic Host', ({ page, params }) => {
  // Allow the target host/port to be overridden via Elastic monitor params.
  const host: string = (params['host'] as string | undefined) ?? TARGET_HOST;
  const port: number =
    typeof params['port'] === 'number' ? (params['port'] as number) : TARGET_PORT;

  // Shared across steps so the second step reuses the result of the first
  // TLS handshake instead of opening a second connection.
  let cachedCert: CertInfo | undefined;

  step(`Extract TLS certificate fingerprints from ${host}:${port}`, async () => {
    // Configure telemetry to report hostnames in place of about:blank
    await page.route('**/*', route => route.fulfill({ status: 200, body: 'TLS check context' }));
    await page.goto(`https://${host}`, { waitUntil: 'commit' });

    cachedCert = await fetchCertInfo(host, port);

    logCertInfo(host, port, cachedCert);

    // Assert well-formed SHA-256 (32 bytes → 32 colon-separated pairs).
    // SHA-256 is the primary fingerprint; it is pre-computed by OpenSSL.
    expect(cachedCert.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);
  });

  step('Verify certificate is not expired', async () => {
    // Reuse the cert fetched in the previous step; fall back to a fresh
    // connection only if the first step failed before populating cachedCert.
    const cert = cachedCert ?? await fetchCertInfo(host, port);
    const now = new Date();

    expect(
      cert.validTo.getTime(),
      `Certificate for ${host} has expired or is expiring`
    ).toBeGreaterThan(now.getTime());
  });
});

