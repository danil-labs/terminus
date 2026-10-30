/**
 * Lo que la ventana ya usa y el motor todavía no publica en su contrato.
 *
 * Los guardas `commands` y `bridge` aceptan estos nombres sin que estén en
 * `commands.json`, cada uno con lo que lo trae. Cuando el contrato copiado ya
 * los tiene, la entrada sobra y los guardas fallan hasta quitarla: esta lista
 * solo se vacía.
 */
export const COMANDOS_PENDIENTES = {
  stop_task_processes: "seldon-host feat/machine-usage (machine_usage_v1, propuesta §3.4); la ventana solo la pide si el host la anuncia",
  engine_update: "seldon-host feat/engine-update (engine_update_v1, propuesta §3.6); la ventana solo la pide si el host la anuncia",
};

export const EVENTOS_PENDIENTES = {};
