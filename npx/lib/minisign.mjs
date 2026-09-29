// Full minisign verification, with no external dependencies.
//
// Terminus signs its installers with minisign in "hashed" mode (BLAKE2b-512
// prehash + Ed25519), which is what the Tauri updater generates. The public key
// is embedded in the app binary (tauri.conf.json -> pubkey) and copied here as a
// constant: it is public by design and seals the chain.
//
// Node 18+ ships everything needed in its `crypto` module:
//   - `blake2b512` as a hash (provided by OpenSSL).
//   - native Ed25519 verification (`crypto.verify(null, ...)`).
// That is why this file imports nothing from outside Node.
//
// A minisign .sig file (base64 over ALL of its content) has 4 lines:
//   1) untrusted comment: ...
//   2) <signature>        = 2 algo bytes ("ED") + 8 bytes keyId + 64 bytes signature
//   3) trusted comment: timestamp:... file:<name>
//   4) <global signature> = Ed25519 over (signature_bytes || trusted_comment_text)
//
// Line 2 signs the file's CONTENT (its BLAKE2b-512 hash): it is the integrity
// proof. Line 4 signs the trusted comment (which includes the file name): it
// authenticates that metadata. We verify both.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function ed25519PublicKey(raw32) {
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw32]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

// Takes the base64 block exactly as it appears in tauri.conf.json (pubkey).
export function parsePublicKey(pubkeyB64) {
  const text = Buffer.from(pubkeyB64, 'base64').toString('utf8');
  const line = text.trim().split('\n')[1]?.trim();
  if (!line) throw new Error('malformed minisign public key');
  const raw = Buffer.from(line, 'base64');
  if (raw.length !== 42) throw new Error('minisign public key has unexpected size');
  return {
    algo: raw.subarray(0, 2).toString('ascii'),
    keyId: raw.subarray(2, 10),
    key: raw.subarray(10, 42),
  };
}

// Takes the contents of the .sig file (base64 of the 4 lines), exactly as it
// comes in the `signature` field of latest.json or in the .sig uploaded to the
// release.
export function parseSignature(sigFileB64) {
  const text = Buffer.from(sigFileB64.trim(), 'base64').toString('utf8');
  const lines = text.split('\n');
  if (lines.length < 4) throw new Error('malformed minisign signature');
  const sigBytes = Buffer.from(lines[1].trim(), 'base64');
  if (sigBytes.length !== 74) throw new Error('minisign signature has unexpected size');
  const trustedComment = lines[2].replace(/^trusted comment: /, '');
  const fileMatch = trustedComment.match(/file:([^\t\n]+)/);
  return {
    algo: sigBytes.subarray(0, 2).toString('ascii'), // "ED" = hashed, "Ed" = legacy
    keyId: sigBytes.subarray(2, 10),
    signature: sigBytes.subarray(10, 74),
    trustedComment,
    signedFileName: fileMatch ? fileMatch[1].trim() : null,
    globalSignature: Buffer.from(lines[3].trim(), 'base64'),
  };
}

async function blake2b512File(filePath) {
  const hash = crypto.createHash('blake2b512');
  await pipeline(fs.createReadStream(filePath), hash);
  return hash.digest();
}

// Verifies a file against a minisign signature with a public key.
// Throws Error (with the specific reason) if anything doesn't add up. It does
// not return a boolean: the caller must abort on any exception.
export async function verifyFile({ filePath, sigFileB64, publicKeyB64, expectedFileName }) {
  const pub = parsePublicKey(publicKeyB64);
  const sig = parseSignature(sigFileB64);

  if (!pub.keyId.equals(sig.keyId)) {
    throw new Error(
      `the signature was made with a different key (keyId ${sig.keyId.toString('hex')} != ${pub.keyId.toString('hex')})`
    );
  }
  if (sig.algo !== 'ED') {
    throw new Error(`unexpected signature algorithm "${sig.algo}" (expected "ED", minisign hashed)`);
  }
  if (expectedFileName && sig.signedFileName && sig.signedFileName !== expectedFileName) {
    throw new Error(
      `the signature is for "${sig.signedFileName}", not for "${expectedFileName}"`
    );
  }

  const pubKeyObj = ed25519PublicKey(pub.key);

  // 1) Content signature: Ed25519 over the file's BLAKE2b-512 hash.
  const digest = await blake2b512File(filePath);
  const contentOk = crypto.verify(null, digest, pubKeyObj, sig.signature);
  if (!contentOk) throw new Error('the content signature does not validate (file altered or wrong signature)');

  // 2) Global signature: Ed25519 over (signature || trusted comment).
  const globalMsg = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, 'utf8')]);
  const globalOk = crypto.verify(null, globalMsg, pubKeyObj, sig.globalSignature);
  if (!globalOk) throw new Error('the trusted comment signature does not validate');

  return {
    keyId: pub.keyId.toString('hex'),
    signedFileName: sig.signedFileName,
    trustedComment: sig.trustedComment,
  };
}
