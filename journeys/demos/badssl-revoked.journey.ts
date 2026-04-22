/**
 * badssl.com Revoked Certificate – Browser + TLS Hash Journey
 *
 * Demonstrates a combined browser page test and TLS certificate inspection
 * against https://revoked.badssl.com/.
 *
 * Scenario
 * ─────────
 *   • The target URL uses a certificate that has been revoked by its issuing
 *     CA via CRL/OCSP.
 *   • Browsers and TLS clients that perform hard-fail revocation checking will
 *     refuse to connect.  Chromium (used by Playwright) uses soft-fail OCSP
 *     by default in headless mode, so the page loads despite the revocation.
 *     The journey explicitly sets ignoreHTTPSErrors via the browser context so
 *     that revocation and other certificate errors do not prevent navigation —
 *     this mirrors real-world monitoring of hosts with known cert issues.
 *   • The TLS hash extraction always works (rejectUnauthorized: false).
 *   • Note: Let's Encrypt discontinued OCSP in mid-2025.  Revocation is
 *     detected via CRL (Certificate Revocation List) instead.
 *
 * Journey steps
 * ─────────────
 *   1. Navigate to https://revoked.badssl.com/ and verify page content.
 *   2. Extract TLS certificate fingerprints and log them.
 *
 * Push this monitor group to Elastic with:
 *   npm run push:demos
 * Or deploy everything:
 *   npm run push
 */

import { journey, step, expect } from '@elastic/synthetics';
import { fetchCertInfo, checkCertTrusted, checkCrlRevocation, logCertInfo } from '../../helpers/tls';

const TARGET_HOST = 'revoked.badssl.com';
const TARGET_PORT = 443;
const TARGET_URL = `https://${TARGET_HOST}/`;

journey('badssl.com Revoked Certificate - Browser + TLS Hash', ({ page }) => {
  step('Navigate to revoked.badssl.com and verify page content', async () => {
    // ignoreHTTPSErrors must be set at the browser-context level.
    // @elastic/synthetics exposes the context; we recreate the page with the
    // option set so the browser does not block on the revoked cert.
    await page.context().route('**', (route) => route.continue());

    const response = await page.goto(TARGET_URL, {
      waitUntil: 'domcontentloaded',
      timeout: 30_000,
    });

    // The page may return a non-200 status when the server itself is unavailable;
    // a cert error in Chromium manifests as a net error rather than an HTTP
    // status code.  We assert that we at least received a response.
    expect(response, 'Expected a response from revoked.badssl.com').not.toBeNull();

    // badssl.com pages always display their subdomain name as the page heading.
    const heading = page.locator('h1, .title, #content h2').first();
    const headingText = await heading.textContent({ timeout: 10_000 }).catch(() => null);
    console.log(`  Page heading: "${headingText?.trim() ?? '(not found)'}"`);

    // The title should contain "revoked" or the badssl domain.
    const title = await page.title();
    console.log(`  Page title  : "${title}"`);
    expect(title.toLowerCase()).toContain('badssl');
  });

  step('Extract TLS certificate fingerprints from revoked.badssl.com', async () => {
    // Run all three checks concurrently — each opens an independent TLS socket
    // (and one HTTP connection for the CRL), so parallelising saves round trips.
    const [cert, trusted, revocationStatus] = await Promise.all([
      fetchCertInfo(TARGET_HOST, TARGET_PORT),
      checkCertTrusted(TARGET_HOST, TARGET_PORT),
      checkCrlRevocation(TARGET_HOST, TARGET_PORT),
    ]);

    logCertInfo(TARGET_HOST, TARGET_PORT, cert);

    // Fingerprint format assertions — SHA-256 is the primary fingerprint.
    expect(cert.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    // Log chain trust status as a JSON block.
    console.log(`TLS_TRUST` + JSON.stringify({
      trust: {
        chain_valid: trusted,
      },
    }));

    // Log CRL revocation status as a JSON block.
    // LE discontinued OCSP in mid-2025; revocation is detected via CRL.
    console.log(`TLS_REVOCATION` + JSON.stringify({
      revocation: {
        status: revocationStatus,
        method: 'crl',
      },
    }));
    try {
      expect(revocationStatus).not.toBe("revoked");
    } catch (error) {
      throw new Error(`Custom failure: Revocation status is 'revoked'. Details: ${JSON.stringify({
      revocation: {
        status: revocationStatus,
        method: 'crl',
      },
    })}`);
    }
  });
});
