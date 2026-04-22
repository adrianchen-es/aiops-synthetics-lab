/**
 * Kibana Login – Multi-Step Browser + TLS Hash Journey
 *
 * Demonstrates a combined multi-step browser journey and TLS certificate
 * extraction against a real Elastic Cloud Kibana deployment.
 *
 * Journey steps
 * ─────────────
 *   1. Navigate to the Kibana URL and verify the login page is displayed.
 *   2. Click the "Log in with Elasticsearch" button.
 *   3. Verify the Elasticsearch native auth login form is shown.
 *   4. Extract TLS certificate fingerprints from the host.
 *
 * The Kibana URL is configurable via the KIBANA_TARGET_URL environment
 * variable or the monitor `params.targetUrl` field in Elastic.
 *
 * Push this monitor group to Elastic with:
 *   npm run push:kibana
 * Or deploy everything:
 *   npm run push
 */

import { journey, step, expect } from '@elastic/synthetics';
import { fetchCertInfo, logCertInfo } from '../../helpers/tls';

const DEFAULT_KIBANA_URL =
  'https://ac-siem-hosted-a183da.kb.us-west2.gcp.elastic-cloud.com/';

journey('Kibana Login - Multi-Step Browser + TLS Hash', ({ page, params }) => {
  const targetUrl: string =
    (params['targetUrl'] as string | undefined) ??
    process.env['KIBANA_TARGET_URL'] ??
    DEFAULT_KIBANA_URL;

  const targetHost = new URL(targetUrl).hostname;
  const targetPort = 443;

  step('Navigate to Kibana and verify login page', async () => {
    await page.goto(targetUrl, { waitUntil: 'domcontentloaded', timeout: 30_000 });

    // Kibana's login page shows a heading or a login card.
    // We look for the "Log in" heading or the Elastic logo.
    const loginIndicator = page
      .locator('[data-test-subj="loginForm"], h1, .euiTitle')
      .first();

    await loginIndicator.waitFor({ state: 'visible', timeout: 15_000 });

    const pageTitle = await page.title();
    console.log(`  Page title: "${pageTitle}"`);

    // Elastic Cloud Kibana login pages include "Elastic" or "Kibana" in the title.
    expect(pageTitle.toLowerCase()).toMatch(/elastic|kibana/);
  });

  step('Click "Log in with Elasticsearch" button', async () => {
    // The "Log in with Elasticsearch" button uses the data-test-subj attribute
    // in Kibana's login page.  Try the test ID first, then fall back to visible
    // button text for robustness across Kibana versions.
    const loginButton = page
      .locator(
        '[data-test-subj="loginWithElasticsearch"], ' +
        'button:has-text("Log in with Elasticsearch"), ' +
        'a:has-text("Log in with Elasticsearch")'
      )
      .first();

    await loginButton.waitFor({ state: 'visible', timeout: 15_000 });
    console.log(`  Clicking "Log in with Elasticsearch"…`);
    await loginButton.click();
  });

  step('Verify Elasticsearch native auth form is displayed', async () => {
    // After clicking the button, Kibana should show the username/password form.
    const usernameField = page
      .locator(
        '[data-test-subj="loginUsername"], ' +
        'input[name="username"], ' +
        'input[placeholder*="username" i], ' +
        'input[type="text"]'
      )
      .first();

    await usernameField.waitFor({ state: 'visible', timeout: 15_000 });
    console.log(`  ✓ Username input is visible – native auth form loaded`);

    const currentUrl = page.url();
    console.log(`  Current URL: ${currentUrl}`);
  });

  step(`Extract TLS certificate fingerprints from ${targetHost}`, async () => {
    const cert = await fetchCertInfo(targetHost, targetPort);
    logCertInfo(targetHost, targetPort, cert);

    // Fingerprint format assertions — SHA-256 is the primary fingerprint.
    expect(cert.sha256).toMatch(/^([0-9A-F]{2}:){31}[0-9A-F]{2}$/);

    // Elastic Cloud certificates should not be expired.
    expect(
      cert.validTo.getTime(),
      `TLS certificate for ${targetHost} has expired`
    ).toBeGreaterThan(Date.now());
  });
});
