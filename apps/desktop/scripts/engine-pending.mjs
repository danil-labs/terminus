/**
 * Lo que la ventana ya usa y el motor todavía no publica en su contrato.
 *
 * Los guardas `commands` y `bridge` aceptan estos nombres sin que estén en
 * `commands.json`, cada uno con lo que lo trae. Cuando el contrato copiado ya
 * los tiene, la entrada sobra y los guardas fallan hasta quitarla: esta lista
 * solo se vacía.
 */
const GITHUB = "GitHub en la cuenta de Danil (seldon-host feat/github-account, contrato del Worker qzpannk9 § Motor)";
const CREDENCIALES = "credenciales de la cuenta de Danil (seldon-host feat/account-credentials, contrato de credenciales § 5)";

export const COMANDOS_PENDIENTES = {
  github_account_status: GITHUB,
  github_account_authorize: GITHUB,
  github_account_installations: GITHUB,
  github_account_set_areas: GITHUB,
  github_account_disconnect: GITHUB,
  account_credential_remove_machine: CREDENCIALES,
  account_credential_restore_machine: CREDENCIALES,
  // Los visuales del chat por partes, con sus imágenes incrustadas (seldon-host `feat/chat-visuals-by-parts`).
  // Hasta que el pin lo traiga, la ventana cae a `tree_show` (512 KiB).
  chat_visual_part: "seldon-host feat/chat-visuals-by-parts",
};

export const EVENTOS_PENDIENTES = {};
