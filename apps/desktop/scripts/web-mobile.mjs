#!/usr/bin/env node
/**
 * Compila el Terminus del teléfono (`apps/mobile`, Expo para web) dentro de la
 * web: `dist-web/<base>m/`, después de `vite build --mode web`. La web de
 * escritorio manda ahí a los teléfonos (`toPhone` en `src/web/main.tsx`), y
 * las dos comparten origen, sesión de la app de Danil y política (`_headers`
 * cubre `<base>*`).
 *
 * Toma los mismos valores públicos que `vite.config.ts` (`TERMINUS_WEB_*`) y
 * se los pasa a Expo como `EXPO_PUBLIC_*`. Necesita `npm ci` en `apps/mobile`:
 * es un proyecto aparte, con su propio lock.
 */
import { spawnSync } from "node:child_process";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const env = process.env;
const mobile = fileURLToPath(new URL("../../mobile/", import.meta.url));
const root = fileURLToPath(new URL("../dist-web/", import.meta.url));
const base = `/${(env.TERMINUS_WEB_BASE ?? "/terminus/").replace(/^\/+|\/+$/g, "")}/`.replace("//", "/");
const out = join(root, base, "m");

if (!existsSync(join(mobile, "node_modules", "expo"))) {
  console.error("web-mobile: falta `npm ci` en apps/mobile; la web saldría sin la versión del teléfono.");
  process.exit(1);
}
if (!existsSync(join(root, base, "index.html"))) {
  console.error("web-mobile: corre primero `vite build --mode web` (no encuentro dist-web).");
  process.exit(1);
}

const origin = (value) => (value ? new URL(value).origin : "");
const expoEnv = {
  ...env,
  TERMINUS_MOBILE_WEB_BASE: `${base}m`,
  // La raíz de la web de escritorio, para «Ver la versión de escritorio» sin adivinarla de la ruta.
  EXPO_PUBLIC_TERMINUS_WEB_BASE: base,
  EXPO_PUBLIC_COMPUTERS_ENDPOINT: origin(env.TERMINUS_WEB_ENDPOINT || "https://computers.danil.ai"),
  EXPO_PUBLIC_TERMINUS_WEB_LOGIN: env.TERMINUS_WEB_LOGIN || "/",
  ...(env.TERMINUS_WEB_SUPABASE_URL ? { EXPO_PUBLIC_SUPABASE_URL: origin(env.TERMINUS_WEB_SUPABASE_URL) } : {}),
  ...(env.TERMINUS_WEB_SUPABASE_KEY ? { EXPO_PUBLIC_SUPABASE_KEY: env.TERMINUS_WEB_SUPABASE_KEY.trim() } : {}),
};
const npx = process.platform === "win32" ? "npx.cmd" : "npx";
const run = spawnSync(npx, ["expo", "export", "--platform", "web", "--output-dir", out], {
  cwd: mobile,
  env: expoEnv,
  stdio: "inherit",
  shell: process.platform === "win32",
});
if (run.status !== 0) process.exit(run.status ?? 1);

// Expo escribe `lang="en"`; la web es en español como la de escritorio.
const page = join(out, "index.html");
writeFileSync(page, readFileSync(page, "utf8").replace('<html lang="en">', '<html lang="es">'));
console.log(`web-mobile: ${out}`);
