/**
 * Self-Signed / Internal CA Certificate Journey
 *
 * Demonstrates the expected behaviour when connecting to a server whose
 * certificate is signed by an internal or self-signed CA that is **not**
 * in the system trust store.
 *
 * Scenario
 * ─────────
 *   Target: https://self-signed.badssl.com/
 *     – Uses a certificate signed by the badssl self-signed CA (not trusted
 *       by any public trust store).
 *
 *   Expected outcomes
 *   ─────────────────
 *   • Connecting with the default trust store (rejectUnauthorized: true) WILL
 *     fail.  This is correct security behaviour and should not be bypassed in
 *     production without explicitly loading the internal CA.
 *   • Fingerprint extraction with rejectUnauthorized: false ALWAYS succeeds.
 *     This lets operators obtain the certificate fingerprint for out-of-band
 *     verification or to configure the internal CA.
 *   • Connecting with the correct internal CA (supplied via the `ca` option)
 *     would succeed.  This journey shows the pattern, but does not supply the
 *     real CA cert — in a real deployment you would load it from a secrets
 *     manager or an environment variable.
 *
 * Journey steps
 * ─────────────
 *   1. Confirm the server REJECTS the connection when no custom CA is loaded
 *      (correct security behaviour).
 *   2. Extract fingerprints regardless using rejectUnauthorized: false.
 *   3. Verify the certificate is not expired (expiry is independent of trust).
 *
 * Push this monitor group to Elastic with:
 *   npm run push:demos
 * Or deploy everything:
 *   npm run push
 */

import { journey, step, expect } from '@elastic/synthetics';
import { fetchCertInfo, checkCertTrusted, logCertInfo, CertInfo } from '../../helpers/tls';

const TARGET_HOST = 'self-signed.badssl.com';
const TARGET_PORT = 443;

journey('Self-Signed / Internal CA - TLS Extraction', ({ page }) => {
  // Shared across steps so step 3 reuses the cert fetched in step 2
  // instead of opening a third TLS connection.
  let cachedCert: CertInfo | undefined;

  step('Confirm untrusted connection is rejected (expected security behaviour)', async () => {
    // Configure telemetry to report hostnames in place of about:blank
    await page.route('**/*', route => route.fulfill({ status: 200, body: 'TLS check context' }));
    await page.goto(`https://${TARGET_HOST}`, { waitUntil: 'commit' });

    const trusted = await checkCertTrusted(TARGET_HOST, TARGET_PORT);

    console.log(`  checkCertTrusted(${TARGET_HOST}) = ${trusted}`);

    // For a self-signed certificate NOT in the system trust store, this MUST
    // be false.  If it returns true, the system trust store has been modified
    // to include the badssl self-signed CA, which would be unusual.
    expect(trusted, 'Self-signed cert should NOT be trusted by the default system CA').toBe(false);

    console.log(
      '  ✓ Connection correctly rejected – to trust this cert, load the issuing CA via the `ca` option'
    );
  });

  step('Extract TLS certificate fingerprints despite missing CA trust', async () => {
    // Even though the cert is not trusted, we can always extract the
    // fingerprint by skipping certificate verification.  This is safe here
    // because we are ONLY reading the certificate, not sending or receiving
    // any application data.
    cachedCert = await fetchCertInfo(TARGET_HOST, TARGET_PORT);
    logCertInfo(TARGET_HOST, TARGET_PORT, cachedCert);

    // Fingerprint format assertions — SHA-256 is the primary fingerprint.
    expect(cachedCert.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    console.log(
      '  ℹ To trust this cert in production, load the issuing CA like this:\n' +
      '    const ca = fs.readFileSync("/path/to/internal-ca.pem");\n' +
      '    const cert = await fetchCertInfo(host, port, { ca });\n' +
      '    // checkCertTrusted(host, port, { ca }) will then return true'
    );
  });

  step('Verify certificate is not expired (independent of CA trust)', async () => {
    // Reuse the cert from the previous step; fall back only if step 2 failed.
    const cert = cachedCert ?? await fetchCertInfo(TARGET_HOST, TARGET_PORT);
    const now = new Date();

    console.log(`  Certificate valid until: ${cert.validTo.toISOString()}`);

    // Expiry is a separate concern from CA trust.  A self-signed cert can be
    // perfectly valid (not expired) while still being untrusted.
    expect(
      cert.validTo.getTime(),
      `TLS certificate for ${TARGET_HOST} has expired`
    ).toBeGreaterThan(now.getTime());
  });

  step('Validate trust status of the self-signed certificate', async () => {
    const trusted = await checkCertTrusted(TARGET_HOST, TARGET_PORT);

    console.log(`  checkCertTrusted(${TARGET_HOST}) = ${trusted}`);

    // For a self-signed certificate NOT in the system trust store, this MUST
    // be false.  If it returns true, the system trust store has been modified
    // to include the badssl self-signed CA, which would be unusual.
    expect(trusted, 'Self-signed cert should NOT be trusted by the default system CA').toBe(false);

    console.log(
      '  ✓ Connection correctly rejected – to trust this cert, load the issuing CA via the `ca` option'
    );
    try {
      expect(trusted).toBe(true);
    } catch (error) {
      throw new Error(`Custom failure: Trust status is 'false'. Details: ${JSON.stringify({
        trust: {
          status: trusted,
        },
      })}`);
    }
  });
});
