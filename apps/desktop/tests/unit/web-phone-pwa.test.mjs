import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

import { PHONE_ICONS, phoneHeaders, phoneManifest } from "../../scripts/web-phone-pwa.mjs";

const mobile = fileURLToPath(new URL("../../../mobile/", import.meta.url));
const exported = fileURLToPath(new URL("../../dist-web/terminus/m/", import.meta.url));
const BASE = "/terminus/";

/** Ancho y alto de un PNG, de su cabecera IHDR. */
function pngSize(path) {
  const bytes = readFileSync(path);
  assert.equal(bytes.toString("latin1", 1, 4), "PNG", `${path} no es PNG`);
  return `${bytes.readUInt32BE(16)}x${bytes.readUInt32BE(20)}`;
}

/** Las etiquetas que vuelven instalable la página, en iOS y en Android. */
function assertInstallableHead(html, where) {
  const has = (pattern, what) => assert.match(html, pattern, `${where}: falta ${what}`);
  has(/<html lang="es">/, 'lang="es"');
  has(/<link rel="manifest" href="manifest\.webmanifest"/, "el manifest");
  has(/<link rel="apple-touch-icon" sizes="180x180" href="icons\/apple-touch-icon\.png"/, "apple-touch-icon");
  has(/<meta name="apple-mobile-web-app-capable" content="yes"/, "apple-mobile-web-app-capable");
  has(/<meta name="mobile-web-app-capable" content="yes"/, "mobile-web-app-capable");
  has(/<meta name="apple-mobile-web-app-title" content="Terminus"/, "apple-mobile-web-app-title");
  has(/<meta name="apple-mobile-web-app-status-bar-style" content="[\w-]+"/, "apple-mobile-web-app-status-bar-style");
  has(/<meta name="theme-color" content="#[0-9a-f]{6}"/, "theme-color");
  has(/<meta name="viewport" content="[^"]*viewport-fit=cover/, "viewport-fit=cover");
  assert.doesNotMatch(html, /serviceWorker/, `${where}: no lleva service worker`);
}

test("el manifest del teléfono es instalable y su scope cubre el inicio de sesión de Danil", () => {
  const manifest = phoneManifest(BASE);
  // `id` y `start_url` no se cambian: cambiarlos obliga a reinstalar.
  assert.equal(manifest.id, "/terminus/m/");
  assert.equal(manifest.start_url, "/terminus/m/");
  assert.equal(manifest.scope, "/");
  assert.notEqual(manifest.id, "/", "la app de Danil ya usa id \"/\" en el mismo origen");
  assert.equal(manifest.display, "standalone");
  assert.equal(manifest.name, "Terminus");
  assert.equal(manifest.short_name, "Terminus");
  assert.equal(manifest.lang, "es");
  assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/);
  assert.match(manifest.background_color, /^#[0-9a-f]{6}$/);

  const sizes = (purpose) => manifest.icons.filter((icon) => icon.purpose === purpose).map((icon) => icon.sizes);
  assert.ok(sizes("any").includes("192x192") && sizes("any").includes("512x512"), "faltan los íconos de 192 y 512");
  assert.ok(sizes("maskable").length > 0, "falta el ícono maskable");
  for (const icon of manifest.icons) {
    assert.ok(icon.src.startsWith("/terminus/m/icons/"), `${icon.src} no está bajo el teléfono`);
  }
});

test("los íconos existen en public/ con el tamaño que dice el manifest", () => {
  for (const icon of PHONE_ICONS) {
    const path = join(mobile, "public", icon.src);
    assert.ok(existsSync(path), `falta ${icon.src}`);
    assert.equal(pngSize(path), icon.sizes, icon.src);
  }
  assert.equal(pngSize(join(mobile, "public/icons/apple-touch-icon.png")), "180x180");
});

test("la plantilla de Expo lleva las etiquetas de PWA y Expo pone la página en español", () => {
  const template = readFileSync(join(mobile, "public/index.html"), "utf8");
  assertInstallableHead(template.replace("%LANG_ISO_CODE%", "es"), "public/index.html");
  const app = JSON.parse(readFileSync(join(mobile, "app.json"), "utf8"));
  assert.equal(app.expo.web.lang, "es");
});

test("index.html y el manifest se revalidan, y los bundles con hash se guardan largo", () => {
  const rules = new Map();
  let path;
  for (const line of phoneHeaders(BASE)) {
    if (!line) continue;
    if (!line.startsWith(" ")) rules.set((path = line), []);
    else rules.get(path).push(line.trim());
  }
  for (const page of ["/terminus/m/", "/terminus/m/index.html", "/terminus/m/manifest.webmanifest"]) {
    assert.ok(rules.get(page)?.includes("Cache-Control: no-cache"), `${page} debe revalidarse`);
  }
  assert.ok(rules.get("/terminus/m/manifest.webmanifest").includes("Content-Type: application/manifest+json"));
  for (const hashed of ["/terminus/m/_expo/static/*", "/terminus/assets/*"]) {
    assert.ok(rules.get(hashed)?.some((header) => header.includes("immutable")), `${hashed} debe guardarse largo`);
  }
});

test("lo exportado por `pnpm web:build` trae el manifest, los íconos y las etiquetas", (t) => {
  if (!existsSync(join(exported, "index.html"))) {
    t.skip("sin dist-web/terminus/m (corre `pnpm web:build`)");
    return;
  }
  assertInstallableHead(readFileSync(join(exported, "index.html"), "utf8"), "dist-web/terminus/m/index.html");
  const manifest = JSON.parse(readFileSync(join(exported, "manifest.webmanifest"), "utf8"));
  assert.deepEqual(manifest, phoneManifest(BASE));
  for (const icon of [...PHONE_ICONS.map((each) => each.src), "icons/apple-touch-icon.png"]) {
    assert.ok(existsSync(join(exported, icon)), `falta ${icon} en la exportación`);
  }
  const headers = readFileSync(fileURLToPath(new URL("../../dist-web/_headers", import.meta.url)), "utf8");
  assert.match(headers, /^\/terminus\/\*\n {2}Content-Security-Policy: default-src 'self'/m, "la CSP permite el manifest y los íconos (default-src/img-src 'self')");
  assert.match(headers, /^\/terminus\/m\/manifest\.webmanifest\n {2}Content-Type: application\/manifest\+json/m);
});
