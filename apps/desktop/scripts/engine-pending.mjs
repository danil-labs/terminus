/**
 * Lo que la ventana ya usa y el motor todavía no publica en su contrato.
 *
 * Los guardas `commands` y `bridge` aceptan estos nombres sin que estén en
 * `commands.json`, cada uno con lo que lo trae. Cuando el contrato copiado ya
 * los tiene, la entrada sobra y los guardas fallan hasta quitarla: esta lista
 * solo se vacía.
 */
const DRIVE = "Google Drive con su CLI (seldon-host, #191)";
const ONBOARDING = "onboarding del motor (seldon-host, #186–#189)";

export const COMANDOS_PENDIENTES = {
  google_drive_status: DRIVE,
  install_google_drive: DRIVE,
  start_google_drive_login: DRIVE,
  finish_google_drive_login: DRIVE,
  cancel_google_drive_login: DRIVE,
  check_google_drive: DRIVE,
  disconnect_google_drive: DRIVE,
  list_system_sessions: ONBOARDING,
  adopt_system_session: ONBOARDING,
  connect_api_key: ONBOARDING,
  cancel_install: ONBOARDING,
  install_size: ONBOARDING,
};

export const EVENTOS_PENDIENTES = {
  "google-drive": DRIVE,
  install: ONBOARDING,
};
