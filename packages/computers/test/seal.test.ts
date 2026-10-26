import assert from "node:assert/strict";
import { createDecipheriv, createPrivateKey, createPublicKey, diffieHellman, generateKeyPairSync, hkdfSync } from "node:crypto";
import { test } from "node:test";
import { canSeal, fromBase64, sealCredential, sealForRecipients, toBase64 } from "../src/index.ts";

/**
 * Vectores de `TERMINUS-SECRET/1` hechos con otra implementación (node:crypto,
 * no WebCrypto), y abajo los del motor: los tres lados dan los mismos bytes.
 */
const VECTORS = [
  {
    recipient_secret: "AQgPFh0kKzI5QEdOVVxjanF4f4aNlJuiqbC3vsXM09o=",
    recipient_public: "yP7Kgb4ZbN8sreq/E8SQPXYy3OSVWqaLbl2a3vVOJhY=",
    eph_secret: "ZWxzeoGIj5adpKuyucDHztXc4+rx+P8GDRQbIikwNz4=",
    nonce: "CRAXHiUsMzpBSE9W",
    workspace_id: "fqgx1w8m",
    slot: "agentes/opencode:cuenta-1",
    plaintext: "sk-zen-0123456789abcdef",
    sealed: "VEVSTUlOVVMtU0VDUkVULzEKFbYJk4ZN6W6KASsA1K5bKB+Rfl0Odvak2KuO0/gxqBoJEBceJSwzOkFIT1bsw1z7XYaQCi/83sL675jE3tfaP1CFVZulKe8dmTYRiZrKrBE3kfE=",
  },
  {
    recipient_secret: "MjlAR05VXGNqcXh/ho2Um6KpsLe+xczT2uHo7/b9BAs=",
    recipient_public: "0K7czGJbHmhCTQcsqu0+1PFPiirnUM1kltfO9z4PTFc=",
    eph_secret: "yM/W3eTr8vkABw4VHCMqMTg/Rk1UW2JpcHd+hYyTmqE=",
    nonce: "AAAAAAAAAAAAAAAA",
    workspace_id: "ws_ñ",
    slot: "mcp/linear/env/LINEAR_API_KEY",
    plaintext: "lin_api_áé😀",
    sealed: "VEVSTUlOVVMtU0VDUkVULzEKtDO2o8K8eKfrS5IZuitzfhitolYtVJwPUvAt+r3tPXIAAAAAAAAAAAAAAAC15m0tXtISGqBj2Y9feba3vYdx86dGACeHc2Ecc6HsYQ==",
  },
  {
    recipient_secret: "TVRbYmlwd36FjJOaoaivtr3Ey9LZ4Ofu9fwDChEYHyY=",
    recipient_public: "QB7cWl8lU1oMR9ld7hvlQH37ugGp5eoHThtcnmz9vzE=",
    eph_secret: "AwoRGB8mLTQ7QklQV15lbHN6gYiPlp2kq7K5wMfO1dw=",
    nonce: "////////////////",
    workspace_id: "w1",
    slot: "referencias/zotero-key",
    plaintext: "",
    sealed: "VEVSTUlOVVMtU0VDUkVULzEKu1D/noKldM+/gg6X9g+5wUPsdBXPUU+M/Zjv9Z4FlhT///////////////+DiAGw9KtBZqzKOFbWr4v3",
  },
];

/**
 * Los vectores de seldon-host (`crates/existing-runtime/tests/fixtures/credential-seal.json`,
 * rama feat/account-credentials), copiados tal cual: ahí `workspace_id`, `slot` y
 * `plaintext` también van en base64.
 */
const ENGINE_VECTORS = [
  {"recipient_secret": "ERERERERERERERERERERERERERERERERERERERERERE=", "recipient_public": "e06Qm75//kTEZaIgA31gjuNYl9Me+XLwf3SJLLD3PxM=", "eph_secret": "IiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiI=", "nonce": "MzMzMzMzMzMzMzMz", "workspace_id": "ZnFneDF3OG0=", "slot": "YWdlbnRlcy9vcGVuY29kZTphMWIyYzM=", "plaintext": "c2stemVuLTEyMzQ1Njc4OTBhYmNkZWY=", "sealed": "VEVSTUlOVVMtU0VDUkVULzEKD6poTtKIZ7l/Smot7l34zpdOdrcBjj8iocTPJnhXDyAzMzMzMzMzMzMzMzP13gNog85+LOuTXhuF670iR2hLiFSE0/P5lioWAUsXxqgG/QTdUic="},
  {"recipient_secret": "REREREREREREREREREREREREREREREREREREREREREQ=", "recipient_public": "/y7kVgHsG2cxDHeQQEWFrmlzMe7hwfjPJBlzHB//Pms=", "eph_secret": "VVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVVU=", "nonce": "ZmZmZmZmZmZmZmZm", "workspace_id": "d3MtMDE=", "slot": "bWNwL2xpbmVhci9lbnYvTElORUFSX0FQSV9LRVk=", "plaintext": "bGluX2FwaV/DgcOJw41fw7FfeHl6", "sealed": "VEVSTUlOVVMtU0VDUkVULzEKOKtmS9hvd9fma92a4HkpE6lP2LM6EmACfktGwfSITGdmZmZmZmZmZmZmZma8S4whHJ5/4ALQlQ7TIpui7Reon0RnHFhJRmPh7tBRS7EKK45G"},
  {"recipient_secret": "d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3d3c=", "recipient_public": "HPV5q6RaELodHvBtkfyiqp7QoRUFFWUxVUBdCxjLmmc=", "eph_secret": "iIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIiIg=", "nonce": "mZmZmZmZmZmZmZmZ", "workspace_id": "d3MtMDI=", "slot": "cmVmZXJlbmNpYXMvem90ZXJvLWtleQ==", "plaintext": "", "sealed": "VEVSTUlOVVMtU0VDUkVULzEKMNPIZaSPzrPWEYV3zy5fIo1v9phmJkdXeFslPLekgGqZmZmZmZmZmZmZmZlTHw8LdlS4t7esJXsJsN/D"},
];

const MAGIC = Buffer.from("TERMINUS-SECRET/1\n");
const PKCS8 = Buffer.from("302e020100300506032b656e04220420", "hex");
const SPKI = Buffer.from("302a300506032b656e032100", "hex");

/** Abre una copia como lo hará el motor, con node:crypto. */
function open(sealed: string, recipientSecret: Buffer, workspace: string, slot: string): string {
  const raw = Buffer.from(sealed, "base64");
  assert.deepEqual(raw.subarray(0, MAGIC.length), MAGIC);
  const eph = raw.subarray(MAGIC.length, MAGIC.length + 32);
  const nonce = raw.subarray(MAGIC.length + 32, MAGIC.length + 44);
  const body = raw.subarray(MAGIC.length + 44);
  const privateKey = createPrivateKey({ key: Buffer.concat([PKCS8, recipientSecret]), format: "der", type: "pkcs8" });
  const recipientPublic = createPublicKey(privateKey).export({ format: "der", type: "spki" }).subarray(12);
  const shared = diffieHellman({ privateKey, publicKey: createPublicKey({ key: Buffer.concat([SPKI, eph]), format: "der", type: "spki" }) });
  const key = Buffer.from(hkdfSync("sha256", shared, Buffer.concat([eph, recipientPublic]), Buffer.from("terminus credential v1"), 32));
  const d = createDecipheriv("aes-256-gcm", key, nonce);
  d.setAAD(Buffer.concat([MAGIC, eph, Buffer.from(workspace), Buffer.from([0]), Buffer.from(slot)]));
  d.setAuthTag(body.subarray(body.length - 16));
  return Buffer.concat([d.update(body.subarray(0, body.length - 16)), d.final()]).toString("utf8");
}

test("este runtime tiene X25519 en WebCrypto", async () => {
  assert.equal(await canSeal(), true);
});

test("sella byte por byte como la otra implementación (vectores)", async () => {
  for (const v of VECTORS) {
    const sealed = await sealCredential(v.recipient_public, v.workspace_id, v.slot, v.plaintext, {
      ephemeralSecret: fromBase64(v.eph_secret),
      nonce: fromBase64(v.nonce),
    });
    assert.equal(sealed, v.sealed, v.slot);
    assert.equal(open(sealed, Buffer.from(v.recipient_secret, "base64"), v.workspace_id, v.slot), v.plaintext);
  }
});

test("sella byte por byte como el motor (vectores de seldon-host)", async () => {
  const text = (b64: string) => Buffer.from(b64, "base64").toString("utf8");
  for (const v of ENGINE_VECTORS) {
    const sealed = await sealCredential(v.recipient_public, text(v.workspace_id), text(v.slot), text(v.plaintext), {
      ephemeralSecret: fromBase64(v.eph_secret),
      nonce: fromBase64(v.nonce),
    });
    assert.equal(sealed, v.sealed, text(v.slot));
  }
});

test("con llave efímera y nonce al azar, la máquina destino la abre y otro workspace o slot no", async () => {
  const pair = generateKeyPairSync("x25519");
  const secret = pair.privateKey.export({ format: "der", type: "pkcs8" }).subarray(16);
  const pub = toBase64(new Uint8Array(pair.publicKey.export({ format: "der", type: "spki" }).subarray(12)));
  const a = await sealCredential(pub, "w1", "agentes/opencode:a", "sk-1");
  const b = await sealCredential(pub, "w1", "agentes/opencode:a", "sk-1");
  assert.notEqual(a, b, "cada sellado usa otra llave efímera");
  assert.equal(open(a, secret, "w1", "agentes/opencode:a"), "sk-1");
  assert.throws(() => open(a, secret, "w2", "agentes/opencode:a"));
  assert.throws(() => open(a, secret, "w1", "agentes/opencode:b"));
});

test("rechaza una llave de orden bajo, una llave mal formada y un valor demasiado largo", async () => {
  // Puntos de orden bajo de Curve25519: el secreto compartido sale en ceros.
  const lowOrder = [new Uint8Array(32), Uint8Array.from([1, ...new Array(31).fill(0)])];
  for (const p of lowOrder) await assert.rejects(sealCredential(toBase64(p), "w", "s", "v"), /non_contributory_key/);
  await assert.rejects(sealCredential(toBase64(new Uint8Array(31)), "w", "s", "v"), /bad_public_key/);
  const pub = toBase64(new Uint8Array(generateKeyPairSync("x25519").publicKey.export({ format: "der", type: "spki" }).subarray(12)));
  await assert.rejects(sealCredential(pub, "w", "s", "x".repeat(16 * 1024 + 1)), /value_too_long/);
});

test("sella para cada destino con llave y salta los que aún no la publicaron", async () => {
  const pub = toBase64(new Uint8Array(generateKeyPairSync("x25519").publicKey.export({ format: "der", type: "spki" }).subarray(12)));
  const copies = await sealForRecipients(
    [
      { computer_id: "cmp_mac", public_key: pub },
      { computer_id: "cmp_vm", public_key: null },
    ],
    "w1",
    "referencias/zotero-key",
    "z",
  );
  assert.deepEqual(copies.map((c) => c.computer_id), ["cmp_mac"]);
  assert.ok(Buffer.from(copies[0]!.sealed, "base64").subarray(0, MAGIC.length).equals(MAGIC));
});

test("una copia alterada no se abre", () => {
  const v = VECTORS[0]!;
  const raw = Buffer.from(v.sealed, "base64");
  raw[raw.length - 1] ^= 1;
  assert.throws(() => open(raw.toString("base64"), Buffer.from(v.recipient_secret, "base64"), v.workspace_id, v.slot));
});
