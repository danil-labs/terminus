#!/usr/bin/env node
/** Los spaces de la ventana, recorridos con el riel agrupado por carpeta. */
import { sleep } from "../../tests/helpers/jsdom-app.mjs";
import { bootPorCarpeta, TASK_AFTER_QUEUE } from "../../tests/helpers/mount-guard.mjs";
import { spaceScenarios } from "../../tests/helpers/mount-spaces.mjs";

await spaceScenarios({ boot: bootPorCarpeta, sleep, CON_TAREA: TASK_AFTER_QUEUE });
// Los árboles montados conservan sus relojes: el proceso no termina solo.
process.exit(0);
