#!/usr/bin/env node
/**
 * Que el contrato copiado, su procedencia y el motor fijado digan el mismo hash.
 *
 * La ventana calcula su contrato con los bytes de `commands.json` y rechaza un
 * motor que anuncie otro (`version_mismatch`). Copiar un `commands.json` nuevo
 * sin publicar el motor que lo habla deja a la ventana sin poder abrir el motor
 * que trae empaquetado.
 *
 * - `commands.json` y PROVENANCE.md tienen que coincidir siempre.
 * - El lock puede ir por detrás solo si `MOTOR_PENDIENTE` nombra ese contrato
 *   con el motivo. Cuando el lock lo alcanza, la entrada sobra y falla.
 * - `publish.yml` no publica mientras el lock y el contrato difieran.
 */
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const CONTRACT = fileURLToPath(new URL("../../src-tauri/crates/engine-protocol/commands.json", import.meta.url));
const PROVENANCE = fileURLToPath(new URL("../../src-tauri/crates/engine-protocol/PROVENANCE.md", import.meta.url));
const LOCK = fileURLToPath(new URL("../../seldon-runtime.lock", import.meta.url));

/** El contrato copiado cuyo motor aún no tiene release publicada, y qué falta. */
const MOTOR_PENDIENTE = {
  contract: "49aa8a5f516665238325495ec861c33a66374c3c4ec4d1141d9e5e43e947b9fa",
  why: "una sesión de Danil por cuenta y cada workspace de una cuenta (danil_sessions, danil_set_default_account, danil_workspace_account, danil_workspace_set_account, el evento danil-sessions y `account` en los comandos de cuenta; seldon-host feat/danil-session-per-account 658cad2): falta fusionarlo, publicar seldon-runtime con él y fijarlo en seldon-runtime.lock",
};

const vendored = createHash("sha256").update(readFileSync(CONTRACT)).digest("hex");
const declared = /SHA-256:\s*`([0-9a-f]{64})`/.exec(readFileSync(PROVENANCE, "utf8"))?.[1];
const pinned = JSON.parse(readFileSync(LOCK, "utf8")).contract;
const failures = [];

if (declared !== vendored) {
  failures.push(
    `commands.json tiene SHA-256 ${vendored} y PROVENANCE.md dice ${declared ?? "nada"}.\n` +
      `  Al copiar el contrato de seldon-host, actualiza su hash y sus cuentas en PROVENANCE.md.`,
  );
}

const pending = MOTOR_PENDIENTE?.contract;
if (pinned === vendored && pending) {
  failures.push(`seldon-runtime.lock ya fija el contrato ${vendored}: quita MOTOR_PENDIENTE de este guarda.`);
} else if (pinned !== vendored && pending !== vendored) {
  failures.push(
    `seldon-runtime.lock fija un motor con contrato ${pinned}; la ventana habla ${vendored}\n` +
      `  y rechaza ese motor (version_mismatch). Publica seldon-runtime con este contrato y fíjalo\n` +
      `  en el lock, o nómbralo en MOTOR_PENDIENTE con lo que falta.`,
  );
}

if (failures.length) {
  for (const f of failures) console.error(f);
  process.exit(1);
}
console.log(
  pinned === vendored
    ? `Contrato ${vendored.slice(0, 8)}: commands.json, PROVENANCE y el motor fijado coinciden.`
    : `Contrato ${vendored.slice(0, 8)}: el motor fijado habla ${pinned.slice(0, 8)}; pendiente: ${MOTOR_PENDIENTE.why}.`,
);
