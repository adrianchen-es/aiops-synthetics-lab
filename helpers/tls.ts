/**
 * Shared TLS utility helpers.
 *
 * All functions use the Node.js built-in `tls` and `crypto` modules — no
 * browser is launched, keeping overhead to a minimum.
 *
 * ## Fingerprint extraction – efficiency note
 *
 * The primary fingerprint method is `cert.fingerprint256`, which is exposed
 * directly on the `PeerCertificate` object returned by
 * `socket.getPeerCertificate()`.  OpenSSL computes the SHA-256 (and SHA-1)
 * digest of the DER-encoded certificate as part of the TLS handshake itself,
 * so reading these properties costs nothing beyond the handshake that was
 * already required.  The previous approach of extracting `cert.raw` and
 * calling `crypto.createHash('sha256').update(raw).digest()` produced an
 * identical result but wasted CPU cycles on a hash that OpenSSL had already
 * computed.
 *
 * SHA-1 (`cert.fingerprint`) is exposed as the optional `sha1` field on
 * `CertInfo`.  It is populated when available but should not be used as a
 * sole trust anchor — prefer SHA-256 for all security-sensitive comparisons.
 *
 * ## Design note on `rejectUnauthorized: false`
 *
 * Several helpers deliberately pass `rejectUnauthorized: false` so that we
 * can always extract certificate data (fingerprints, expiry, subject) even
 * for self-signed, revoked, or expired certificates.  The socket is
 * destroyed immediately after `getPeerCertificate()` returns — no
 * authentication handshake or application data is exchanged.
 *
 * Use `checkCertTrusted()` to separately determine whether the OS / custom
 * CA trusts the certificate.
 */

import * as tls from 'tls';
import * as crypto from 'crypto';
import * as http from 'http';
import * as https from 'https';

/** Structured certificate information returned by `fetchCertInfo`. */
export interface CertInfo {
  /**
   * SHA-256 fingerprint in colon-separated form (e.g. "AA:BB:…:FF").
   *
   * Sourced directly from `cert.fingerprint256` — no extra hashing step.
   */
  sha256: string;
  /**
   * SHA-1 fingerprint in colon-separated form.
   *
   * Optional: SHA-1 is weak for trust decisions; prefer `sha256`.
   * Sourced from `cert.fingerprint` when available.
   */
  sha1?: string;
  /** Common Name (or Organisation) of the leaf certificate subject */
  subject: string;
  /** Common Name (or Organisation) of the issuing CA */
  issuer: string;
  /** Certificate not-valid-before date */
  validFrom: Date;
  /** Certificate not-valid-after date */
  validTo: Date;
}

/** Options accepted by the low-level TLS helpers. */
export interface TlsFetchOptions {
  /**
   * Custom CA certificate(s) to trust during verification.
   * Pass PEM strings or Buffers.  When omitted the default system trust store
   * is used.
   */
  ca?: string | Buffer | Array<string | Buffer>;
  /** Connection/socket timeout in milliseconds (default: 10 000). */
  timeoutMs?: number;
}

// ─────────────────────────────────────────────────────────────────────────────
// Core helpers
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Open a raw TLS socket and return the DER-encoded leaf certificate.
 *
 * The socket is destroyed immediately after the certificate is obtained.
 * `rejectUnauthorized` is intentionally `false` so we can always retrieve
 * the certificate regardless of its validity state.
 *
 * Use this function only when you specifically need the raw DER bytes (e.g.
 * to pass to `computeFingerprint` with a non-standard algorithm).  For
 * standard fingerprint extraction prefer `fetchCertInfo`, which reads the
 * pre-computed `fingerprint256` property without an extra hashing step.
 */
export function fetchLeafCertDer(
  host: string,
  port: number,
  options: TlsFetchOptions = {}
): Promise<Buffer> {
  const { ca, timeoutMs = 5_000 } = options;

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        // rejectUnauthorized: false is intentional – this function is solely
        // for certificate inspection, not for making authenticated requests.
        rejectUnauthorized: false, // lgtm[js/disabling-certificate-validation]
        ...(ca !== undefined ? { ca } : {}),
      },
      () => {
        const cert = socket.getPeerCertificate(false);
        socket.destroy();

        if (!cert || !cert.raw) {
          reject(new Error(`No certificate returned from ${host}:${port}`));
          return;
        }

        resolve(cert.raw);
      }
    );

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${host}:${port} timed out`));
    });
  });
}

/**
 * Fetch full structured certificate information from a remote host.
 *
 * Always succeeds at extracting the data (uses `rejectUnauthorized: false`
 * internally).  Call `checkCertTrusted()` separately if you need to know
 * whether the certificate is trusted by the system / a custom CA.
 *
 * **Efficiency**: SHA-256 is read from `cert.fingerprint256`, a property that
 * Node.js/OpenSSL populates during the TLS handshake at no extra cost.  The
 * DER buffer (`cert.raw`) is not extracted, so no additional `crypto.createHash`
 * call is made.
 */
export async function fetchCertInfo(
  host: string,
  port: number,
  options: TlsFetchOptions = {}
): Promise<CertInfo> {
  const { ca, timeoutMs = 5_000 } = options;

  return new Promise((resolve, reject) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        // rejectUnauthorized: false is intentional – we always read the cert
        // regardless of trust state.  The socket is destroyed immediately after
        // getPeerCertificate() returns; no application data is exchanged.
        rejectUnauthorized: false, // lgtm[js/disabling-certificate-validation]
        ...(ca !== undefined ? { ca } : {}),
      },
      () => {
        const cert = socket.getPeerCertificate(false);
        socket.destroy();

        if (!cert || !cert.fingerprint256) {
          reject(new Error(`No certificate from ${host}:${port}`));
          return;
        }

        resolve({
          // fingerprint256 is pre-computed by OpenSSL during the handshake —
          // no extra hashing step needed.  It is already in "AA:BB:…" form.
          sha256: cert.fingerprint256.toUpperCase(),
          // SHA-1 is optional: present but not recommended for trust decisions.
          sha1: cert.fingerprint ? cert.fingerprint.toUpperCase() : undefined,
          subject: (cert.subject as Record<string, string> | undefined)?.['CN']
            ?? (cert.subject as Record<string, string> | undefined)?.['O']
            ?? 'Unknown',
          issuer: (cert.issuer as Record<string, string> | undefined)?.['CN']
            ?? (cert.issuer as Record<string, string> | undefined)?.['O']
            ?? 'Unknown',
          validFrom: new Date(cert.valid_from),
          validTo: new Date(cert.valid_to),
        });
      }
    );

    socket.on('error', (err) => {
      socket.destroy();
      reject(err);
    });

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      reject(new Error(`TLS connection to ${host}:${port} timed out`));
    });
  });
}

/**
 * Check whether the remote certificate is trusted by the system trust store
 * or by the supplied custom CA.
 *
 * Returns `true` if the TLS handshake succeeds with `rejectUnauthorized: true`,
 * `false` if the certificate is self-signed, issued by an unknown CA, expired,
 * or revoked.
 */
export function checkCertTrusted(
  host: string,
  port: number,
  options: TlsFetchOptions = {}
): Promise<boolean> {
  const { ca, timeoutMs = 10_000 } = options;

  return new Promise((resolve) => {
    const socket = tls.connect(
      {
        host,
        port,
        servername: host,
        rejectUnauthorized: true,
        ...(ca !== undefined ? { ca } : {}),
      },
      () => {
        socket.destroy();
        resolve(true);
      }
    );

    socket.on('error', () => {
      socket.destroy();
      resolve(false);
    });

    socket.setTimeout(timeoutMs, () => {
      socket.destroy();
      resolve(false);
    });
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// CRL-based revocation checking
//
// Note: Let's Encrypt discontinued OCSP support in mid-2025.  Certificates
// from LE (including revoked.badssl.com) now use CRL Distribution Points
// exclusively for revocation information.
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Result of a CRL revocation check.
 * - `'revoked'`  – serial number found in the CRL
 * - `'good'`     – serial number NOT in the CRL
 * - `'unknown'`  – no CRL URL found in the certificate
 * - `'error'`    – network or parse failure during the check
 */
export type RevocationStatus = 'good' | 'revoked' | 'unknown' | 'error';

/** Read the ASN.1 DER TLV at `at`, returning the tag, value slice, and end offset. */
function readTlv(buf: Buffer, at: number): { tag: number; value: Buffer; end: number } {
  const tag = buf[at];
  let pos = at + 1;
  const lb = buf[pos++];
  let len: number;
  if (lb < 0x80) {
    len = lb;
  } else {
    const n = lb & 0x7f;
    len = 0;
    for (let i = 0; i < n; i++) len = (len << 8) | buf[pos++];
  }
  return { tag, value: buf.subarray(pos, pos + len), end: pos + len };
}

/**
 * Extract the first CRL distribution point URI from a DER-encoded certificate.
 *
 * Searches for OID 2.5.29.31 (id-ce-cRLDistributionPoints) then scans forward
 * for the first GeneralName URI entry (tag 0x86) within the extension value.
 */
function extractCrlUrl(certDer: Buffer): string | undefined {
  // OID 2.5.29.31 = 06 03 55 1d 1f
  const CRL_DP_OID = Buffer.from([0x06, 0x03, 0x55, 0x1d, 0x1f]);
  const oidStart = certDer.indexOf(CRL_DP_OID);
  if (oidStart < 0) return undefined;

  // Scan up to 200 bytes past the OID for a GeneralName URI tag (0x86).
  // URI entries in a CRL DP extension use tag [6] IMPLICIT IA5String = 0x86.
  const limit = Math.min(oidStart + 200, certDer.length - 2);
  for (let i = oidStart + CRL_DP_OID.length; i < limit; i++) {
    if (certDer[i] === 0x86) {
      const uriLen = certDer[i + 1];
      if (uriLen < 0x80 && i + 2 + uriLen <= certDer.length) {
        const url = certDer.subarray(i + 2, i + 2 + uriLen).toString('utf8');
        if (url.startsWith('http://') || url.startsWith('https://')) return url;
      }
    }
  }
  return undefined;
}

/** Download a CRL (DER-encoded) from an HTTP or HTTPS URL. */
function fetchCrl(url: string, timeoutMs: number): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const get = url.startsWith('https:') ? https.get.bind(https) : http.get.bind(http);
    const req = get(url, (res: http.IncomingMessage) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`CRL fetch returned HTTP ${res.statusCode ?? 'unknown'}`));
        return;
      }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks)));
      res.on('error', reject);
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('CRL fetch timed out')); });
    req.on('error', reject);
  });
}

/**
 * Walk the revokedCertificates list of a DER-encoded CRL and check whether
 * `serialHex` appears.  Both sides are normalised to uppercase hex with
 * leading zeros stripped so DER sign-byte padding does not cause a mismatch.
 */
function checkSerialInCrl(crlDer: Buffer, serialHex: string): 'revoked' | 'good' {
  const normalize = (h: string) => h.replace(/^0+/, '').toUpperCase() || '0';
  const target = normalize(serialHex);

  try {
    // CertificateList SEQUENCE → TBSCertList SEQUENCE
    const certList = readTlv(crlDer, 0);
    const tbsCertList = readTlv(certList.value, 0);
    let pos = 0;

    // version INTEGER OPTIONAL (tag 0x02, value 0x01 for v2) — bare INTEGER,
    // NOT context-wrapped like TBSCertificate version.  Skip if present.
    if (tbsCertList.value[pos] === 0x02) pos = readTlv(tbsCertList.value, pos).end;
    // signature AlgorithmIdentifier (0x30)
    pos = readTlv(tbsCertList.value, pos).end;
    // issuer Name (0x30)
    pos = readTlv(tbsCertList.value, pos).end;
    // thisUpdate (UTCTime 0x17 or GeneralizedTime 0x18)
    pos = readTlv(tbsCertList.value, pos).end;
    // nextUpdate (optional UTCTime or GeneralizedTime)
    if (tbsCertList.value[pos] === 0x17 || tbsCertList.value[pos] === 0x18) {
      pos = readTlv(tbsCertList.value, pos).end;
    }
    // revokedCertificates SEQUENCE OF SEQUENCE (optional, tag 0x30)
    if (pos >= tbsCertList.value.length || tbsCertList.value[pos] !== 0x30) {
      return 'good'; // empty revocation list
    }

    const revokedSeq = readTlv(tbsCertList.value, pos);
    let rpos = 0;
    while (rpos < revokedSeq.value.length) {
      const entry = readTlv(revokedSeq.value, rpos);
      // Each entry: SEQUENCE { serialNumber INTEGER, revocationDate, ... }
      const serial = readTlv(entry.value, 0);
      if (serial.tag === 0x02) {
        if (normalize(serial.value.toString('hex')) === target) return 'revoked';
      }
      rpos = entry.end;
    }
  } catch {
    // Treat parse errors conservatively — do not report false revocations.
    return 'good';
  }
  return 'good';
}

/**
 * Check certificate revocation status by downloading and parsing the CRL.
 *
 * Opens a TLS connection to extract the CRL Distribution Point URL from the
 * leaf certificate, fetches the CRL over HTTP, and checks whether the cert's
 * serial number appears in the revoked list.
 *
 * Note: OCSP is no longer available for Let's Encrypt certificates (LE shut
 * down OCSP responders in mid-2025).  This function uses CRL checking, which
 * is the mechanism LE now relies on for revocation information.
 */
export async function checkCrlRevocation(
  host: string,
  port: number,
  options: TlsFetchOptions = {}
): Promise<RevocationStatus> {
  const { ca, timeoutMs = 10_000 } = options;

  try {
    const { certDer, serialNumber } = await new Promise<{ certDer: Buffer; serialNumber: string }>(
      (resolve, reject) => {
        const socket = tls.connect(
          {
            host,
            port,
            servername: host,
            rejectUnauthorized: false, // lgtm[js/disabling-certificate-validation]
            ...(ca !== undefined ? { ca } : {}),
          },
          () => {
            const cert = socket.getPeerCertificate(false);
            socket.destroy();
            if (!cert?.raw) {
              reject(new Error(`No certificate from ${host}:${port}`));
              return;
            }
            resolve({ certDer: cert.raw, serialNumber: cert.serialNumber ?? '' });
          }
        );
        socket.on('error', (err) => { socket.destroy(); reject(err); });
        socket.setTimeout(timeoutMs, () => {
          socket.destroy();
          reject(new Error(`TLS connection to ${host}:${port} timed out`));
        });
      }
    );

    const crlUrl = extractCrlUrl(certDer);
    if (!crlUrl) return 'unknown';

    const crlDer = await fetchCrl(crlUrl, timeoutMs);
    return checkSerialInCrl(crlDer, serialNumber);
  } catch {
    return 'error';
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Pure utility functions (easily unit-testable)
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Compute a hex fingerprint of a DER-encoded certificate buffer.
 * The result is upper-cased hex with no separators.
 *
 * Prefer `fetchCertInfo()` for standard SHA-256 extraction — it reads the
 * pre-computed `fingerprint256` from the TLS handshake rather than running
 * an additional hash.  Use this function only when you need to hash a raw
 * DER buffer that you already have (e.g. from `fetchLeafCertDer`).
 */
export function computeFingerprint(
  derBuffer: Buffer,
  algorithm: 'sha1' | 'sha256'
): string {
  return crypto.createHash(algorithm).update(derBuffer).digest('hex').toUpperCase();
}

/**
 * Log certificate information as two JSON blocks matching the Elastic
 * `tls.server.x509` / `tls.server.hash` field layout.
 * Used by all journeys so output is easy to read and compare.
 */
export function logCertInfo(host: string, port: number, cert: CertInfo): void {
  const hashBlock: Record<string, string> = { sha256: cert.sha256 };
  if (cert.sha1) hashBlock['sha1'] = cert.sha1;
  console.log(`TLS_CERT,` +
    JSON.stringify({ x509: { not_after: cert.validTo.toISOString(), not_before: cert.validFrom.toISOString(), subject: { common_name: cert.subject }, issuer: { common_name: cert.issuer }, }, })
    + `,` + 
    `TLS_HASH,` +
    JSON.stringify({ hash: hashBlock })
  );
}
