// Verificación minisign completa, sin dependencias externas.
//
// Terminus firma sus instaladores con minisign en modo "hashed" (prehash
// BLAKE2b-512 + Ed25519), que es lo que genera el updater de Tauri. La clave
// pública está embebida en el binario de la app (tauri.conf.json -> pubkey) y
// se copia aquí como constante: es pública por diseño y sella la cadena.
//
// Node 18+ trae todo lo necesario en su módulo `crypto`:
//   - `blake2b512` como hash (lo provee OpenSSL).
//   - verificación Ed25519 nativa (`crypto.verify(null, ...)`).
// Por eso este archivo no importa nada fuera de Node.
//
// Un archivo .sig de minisign (base64 sobre TODO su contenido) tiene 4 líneas:
//   1) untrusted comment: ...
//   2) <firma>            = 2 bytes algo ("ED") + 8 bytes keyId + 64 bytes firma
//   3) trusted comment: timestamp:... file:<nombre>
//   4) <firma global>     = Ed25519 sobre (firma_bytes || texto_trusted_comment)
//
// La línea 2 firma el CONTENIDO del archivo (su hash BLAKE2b-512): es la prueba
// de integridad. La línea 4 firma el comentario de confianza (incluye el nombre
// del archivo): autentica ese metadato. Verificamos las dos.

import crypto from 'node:crypto';
import fs from 'node:fs';
import { pipeline } from 'node:stream/promises';

import { t } from './i18n.mjs';

const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

function ed25519PublicKey(raw32) {
  const der = Buffer.concat([ED25519_SPKI_PREFIX, raw32]);
  return crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
}

// Recibe el bloque base64 tal cual está en tauri.conf.json (pubkey).
export function parsePublicKey(pubkeyB64) {
  const text = Buffer.from(pubkeyB64, 'base64').toString('utf8');
  const line = text.trim().split('\n')[1]?.trim();
  if (!line) throw new Error(t('badPublicKey'));
  const raw = Buffer.from(line, 'base64');
  if (raw.length !== 42) throw new Error(t('badPublicKeySize'));
  return {
    algorithm: raw.subarray(0, 2).toString('ascii'),
    keyId: raw.subarray(2, 10),
    key: raw.subarray(10, 42),
  };
}

// Recibe el contenido del archivo .sig (base64 de las 4 líneas), tal cual viene
// en el campo `signature` de latest.json o en el .sig subido a la release.
export function parseSignature(sigFileB64) {
  const text = Buffer.from(sigFileB64.trim(), 'base64').toString('utf8');
  const lines = text.split('\n');
  if (lines.length < 4) throw new Error(t('badSignature'));
  const sigBytes = Buffer.from(lines[1].trim(), 'base64');
  if (sigBytes.length !== 74) throw new Error(t('badSignatureSize'));
  const trustedComment = lines[2].replace(/^trusted comment: /, '');
  // El nombre termina en el primer espacio o tabulador: lo que siga es otro campo.
  const fileMatch = trustedComment.match(/file:(\S+)/);
  return {
    algorithm: sigBytes.subarray(0, 2).toString('ascii'), // "ED" = hashed, "Ed" = legacy
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

// Verifica un archivo contra una firma minisign con una clave pública.
// Lanza Error (con motivo concreto) si algo no cuadra. No devuelve booleano:
// el llamador debe abortar ante cualquier excepción.
export async function verifyFile({ filePath, sigFileB64, publicKeyB64, expectedFileName }) {
  const pub = parsePublicKey(publicKeyB64);
  const sig = parseSignature(sigFileB64);

  if (!pub.keyId.equals(sig.keyId)) {
    throw new Error(t('otherKey', { got: sig.keyId.toString('hex'), expected: pub.keyId.toString('hex') }));
  }
  if (sig.algorithm !== 'ED') {
    throw new Error(t('badAlgorithm', { got: sig.algorithm }));
  }
  if (expectedFileName && sig.signedFileName && sig.signedFileName !== expectedFileName) {
    throw new Error(t('wrongFile', { signed: sig.signedFileName, expected: expectedFileName }));
  }

  const pubKeyObj = ed25519PublicKey(pub.key);

  // 1) Firma del contenido: Ed25519 sobre el hash BLAKE2b-512 del archivo.
  const digest = await blake2b512File(filePath);
  const contentOk = crypto.verify(null, digest, pubKeyObj, sig.signature);
  if (!contentOk) throw new Error(t('contentMismatch'));

  // 2) Firma global: Ed25519 sobre (firma || comentario de confianza).
  const globalMsg = Buffer.concat([sig.signature, Buffer.from(sig.trustedComment, 'utf8')]);
  const globalOk = crypto.verify(null, globalMsg, pubKeyObj, sig.globalSignature);
  if (!globalOk) throw new Error(t('commentMismatch'));

  return {
    keyId: pub.keyId.toString('hex'),
    signedFileName: sig.signedFileName,
    trustedComment: sig.trustedComment,
  };
}
