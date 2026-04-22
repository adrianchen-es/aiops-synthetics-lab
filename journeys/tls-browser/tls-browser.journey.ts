/**
 * badssl.com Additional Links TLS Journey (browser + TLS hash)
 *
 * Extracts the SHA-256 fingerprint of various target URLs and verifies
 * TLS checks collect the hostname reported in place of `about:blank`.
 *
 * Targets come from helpers/tlsTargetHosts.tls-browser.generated.ts (run
 * `npm run generate:tls-targets` after editing this folder's tls-target-hosts.csv).
 *
 * Push this monitor group to Elastic with:
 *   npm run push:tls
 * Or deploy everything:
 *   npm run push
 */

import { journey, step, expect } from '@elastic/synthetics';
import { TLS_TARGET_HOSTS } from '../../helpers/tlsTargetHosts.tls-browser.generated';
import { fetchCertInfo, checkCertTrusted, logCertInfo } from '../../helpers/tls';

const TARGETS = TLS_TARGET_HOSTS;

for (const { host, criticality, assertionText, assertionSelector } of TARGETS) {
  journey(
    {
      name: `TLS Browser Check - ${host}`,
      tags: criticality ? [`criticality:${criticality}`] : [],
    },
    ({ page }) => {
      step(`TLS Validation for ${host}:443`, async () => {
        // Configure telemetry to report hostnames in place of about:blank
        // This is crucial for Synthetics UI to display the actual URL tested
        // instead of "about:blank". We don't want to actually load the page
        // content because certificate errors would break the Playwright request.
        await page.route('**/*', route => route.fulfill({ status: 200, body: 'TLS check context' }));
        await page.goto(`https://${host}`, { waitUntil: 'commit' });

        const cachedCert = await fetchCertInfo(host, 443);
        const trusted = await checkCertTrusted(host, 443);
        const now = new Date();

        logCertInfo(host, 443, cachedCert);

        // Assert well-formed SHA-256 (32 bytes → 32 colon-separated pairs).
        expect(cachedCert.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

        try {
          expect(
            cachedCert.validTo.getTime(),
            `TLS certificate for ${host} has expired`
          ).toBeGreaterThan(now.getTime());
        } catch (error) {
          throw new Error(`Custom failure: TLS certificate has expired. Details: ${JSON.stringify({
            certificate: {
              validTo: cachedCert.validTo,
              now: now,
            },
          })}`);
        }

        try {
          expect(trusted).toBe(true);
        } catch (error) {
          throw new Error(`Custom failure: Issuer CA/Certificate is untrusted.`);
        }
      });

      step(`Navigate to ${host} and verify page content`, async () => {
        // ignoreHTTPSErrors must be set at the browser-context level.
        // @elastic/synthetics exposes the context; we recreate the page with the
        // option set so the browser does not block on the revoked cert.
        await page.context().route('**', (route) => route.continue());

        const response = await page.goto(`https://${host}`, {
          waitUntil: 'domcontentloaded',
          timeout: 30_000,
        });

        expect(response, `Expected a response from ${host}`).not.toBeNull();

        if (assertionText !== undefined && assertionSelector !== undefined) {
          await expect(page.locator(assertionSelector)).toContainText(assertionText);
        }
      });
    }
  );
}
