/**
 * Lo que el agente hizo, como filas legibles.
 *
 * **La transcripción es el objeto que el gate aprueba.** Una conversación que no
 * deja ver qué leyó y qué cambió el agente no se puede revisar, así que cada
 * herramienta que usó es una fila con nombre propio: qué hizo y sobre qué.
 *
 * Este archivo es el modelo —clasificar, nombrar, agrupar— y no pinta nada.
 * Separarlo del componente es lo que permite que el mismo dato entre por dos
 * puertas: en vivo desde los eventos del turno, y al reabrir una sesión desde el
 * rastro que se guardó (#58). Las dos llaman a `pasoDe`.
 *
 * **Los verbos salen del catálogo; los nombres de herramienta no.** `Read`,
 * `command_execution` y `file_change` son como los llama el agente —dato de
 * máquina, y por eso van en mono al lado del verbo—: traducirlos rompería el
 * emparejamiento con lo que manda `runtime/chat/`.
 */
import { manifiesto, t } from "./i18n.ts";

/** Qué clase de acto fue. Decide el verbo y el ícono de la fila. */
export type Clase =
  | "leer"
  | "buscar"
  | "editar"
  | "ejecutar"
  | "web"
  | "plan"
  | "otro"
  /* Los tres que no son herramientas: el turno hablando de sí mismo. */
  | "aviso"
  | "gasto"
  | "fin"
  /**
   * Lo que una persona autorizó o negó dentro del turno.
   *
   * **Es una fila y no una tarjeta, y eso arregla dos cosas a la vez.** Vivía
   * como un bloque aparte en la transcripción, así que además de pesar más que
   * el acto que describe **partía la tira de pasos en dos**: lo de antes de la
   * decisión se quedaba suelto y lo de después caía dentro de «Trabajó durante
   * …», sin que nada explicara la diferencia. Como paso, la decisión va donde
   * ocurrió y el turno se lee entero.
   */
  | "permiso";

/** El cuerpo de un paso, tal como lo manda `runtime/chat/`. */
export type Detalle =
  | {
      kind: "output";
      text: string;
      exit_code: number | null;
      truncated: boolean;
      /** La carpeta desde la que la persona lanzó este comando. */
      cwd?: string;
      /** Resultados visuales del comando; se entregan fuera del registro al cerrar. */
      images?: string[];
    }
  | { kind: "edit"; before: string | null; after: string };

export type Paso = {
  /** Con qué evento empareja el cierre. Lo pone el agente. */
  id?: string;
  clase: Clase;
  /** Cómo la nombró el agente: `Read`, `command_execution`. Dato de máquina. */
  nombre: string;
  /** Sobre qué actuó: la ruta, el comando, el patrón. */
  objetivo: string | null;
  detalle: Detalle | null;
  mcpApp?: {
    server: string;
    tool: string;
    arguments?: Record<string, unknown> | null;
    result?: Record<string, unknown> | null;
  };
  /** Todavía corriendo: la llamada salió y el resultado no ha vuelto. */
  corriendo: boolean;
  /** `false` si la herramienta falló. `null` mientras no se sepa. */
  ok: boolean | null;
  /**
   * Qué se decidió, **solo en `permiso`**. Va aparte de `ok` a propósito: negar
   * no es fallar. `ok === false` pinta la fila de rojo y le cuelga «falló», y
   * una denegación es una decisión que se tomó bien.
   */
  permitido?: boolean;
  /** Solo en `permiso`: la tarea que decidió, cuando no fue la persona. */
  decidio?: string;
};

/**
 * De qué clase es una herramienta.
 *
 * Los nombres de Claude y los tipos de item de Codex conviven en la misma tabla
 * porque nombran lo mismo: `Bash` y `command_execution` son «ejecutó algo». Lo
 * que no está en la tabla cae en `otro` y se muestra con su nombre crudo, que es
 * más honesto que forzarlo a una categoría.
 */
export function clasificar(nombre: string): Clase {
  switch (nombre) {
    case "Read":
    case "NotebookRead":
      return "leer";
    case "Write":
    case "Edit":
    case "NotebookEdit":
    case "file_change":
      return "editar";
    case "Bash":
    case "BashOutput":
    case "KillShell":
    case "command_execution":
      return "ejecutar";
    case "Glob":
    case "Grep":
      return "buscar";
    case "WebFetch":
    case "WebSearch":
    case "web_search":
      return "web";
    case "TodoWrite":
    case "todo_list":
      return "plan";
    default:
      return "otro";
  }
}

/** Un paso recién abierto. Es la puerta por la que entra todo. */
export function pasoDe(
  nombre: string,
  objetivo: string | null = null,
  extra: Partial<Paso> = {},
): Paso {
  return {
    clase: clasificar(nombre),
    nombre,
    objetivo,
    detalle: null,
    corriendo: false,
    ok: null,
    ...extra,
  };
}

/** Lo que la persona, o la tarea que lanzó a esta, autorizó o negó. */
export function pasoDePermiso(
  herramienta: string,
  objetivo: string | null,
  permitido: boolean,
  decidio?: string,
): Paso {
  return {
    clase: "permiso",
    nombre: herramienta,
    objetivo,
    detalle: null,
    corriendo: false,
    ok: null,
    permitido,
    decidio,
  };
}

/** Una línea del turno que no es una herramienta: un aviso, el gasto, el cierre. */
export function pasoDeSistema(clase: Clase, texto: string): Paso {
  return { clase, nombre: clase, objetivo: texto, detalle: null, corriendo: false, ok: null };
}

/**
 * Una fila de la línea de tiempo: uno o varios pasos que se leen como un acto.
 *
 * Doce lecturas seguidas son «Leyó 12 archivos», no doce renglones — es lo que
 * hace que un turno con diez herramientas ocupe menos que la respuesta. Un
 * comando **no** se junta con el de al lado: cada uno trae su propia salida, y
 * una fila con dos cuerpos no es una fila.
 */
export type Fila = { clase: Clase; pasos: Paso[] };

/** Las clases que se juntan cuando vienen seguidas. */
const JUNTABLES: Clase[] = ["leer", "buscar", "editar", "web", "plan", "otro"];

export function agrupar(pasos: Paso[]): Fila[] {
  const filas: Fila[] = [];
  for (const p of pasos) {
    const ultima = filas[filas.length - 1];
    const junta =
      ultima?.clase === p.clase &&
      JUNTABLES.includes(p.clase) &&
      p.detalle === null && !p.mcpApp &&
      ultima.pasos.every((q) => q.detalle === null);
    if (junta) ultima.pasos.push(p);
    else filas.push({ clase: p.clase, pasos: [p] });
  }
  return filas;
}

/**
 * La cabecera de un tramo de trabajo: cuántos actos de cada clase, en prosa.
 * `null` si el tramo no tiene ninguno que contar — solo avisos, gasto o cierre.
 */
export function cuentaDelTramo(pasos: Paso[], vivo = false): string | null {
  const de = (clase: Clase) => pasos.filter((p) => p.clase === clase);
  const editados = archivosDistintos(de("editar"));
  const permisos = de("permiso");
  const cuentas: [number, (count: number) => string][] = vivo
    ? [
        [de("leer").length, (count) => t("common.steps.summary_live.read", { count })],
        [de("buscar").length, (count) => t("common.steps.summary_live.search", { count })],
        [editados, (count) => t("common.steps.summary_live.edit", { count })],
        [de("ejecutar").length, (count) => t("common.steps.summary_live.run", { count })],
        [de("web").length, (count) => t("common.steps.summary_live.web", { count })],
        [de("plan").length, (count) => t("common.steps.summary_live.plan", { count })],
        [de("otro").length, (count) => t("common.steps.summary_live.other", { count })],
      ]
    : [
        [de("leer").length, (count) => t("common.steps.summary.read", { count })],
        [de("buscar").length, (count) => t("common.steps.summary.search", { count })],
        [editados, (count) => t("common.steps.summary.edit", { count })],
        [de("ejecutar").length, (count) => t("common.steps.summary.run", { count })],
        [de("web").length, (count) => t("common.steps.summary.web", { count })],
        [de("plan").length, (count) => t("common.steps.summary.plan", { count })],
        [de("otro").length, (count) => t("common.steps.summary.other", { count })],
      ];
  cuentas.push(
    [permisos.filter((p) => p.permitido).length, (count) => t("common.steps.summary.allowed", { count })],
    [permisos.filter((p) => !p.permitido).length, (count) => t("common.steps.summary.denied", { count })],
  );
  const partes = cuentas.filter(([n]) => n > 0).map(([n, frase]) => frase(n));
  if (partes.length === 0) return null;
  const frase = partes.join(t("common.steps.summary.separator"));
  return frase.charAt(0).toLocaleUpperCase(manifiesto().formato) + frase.slice(1);
}

/** Tres ediciones al mismo archivo son un archivo que revisar, no tres. */
function archivosDistintos(pasos: Paso[]) {
  return new Set(pasos.map((p, i) => p.objetivo ?? `#${i}`)).size;
}

/** El nombre de archivo de una ruta, en las dos convenciones de barra. */
export function nombreDe(ruta: string) {
  return ruta.split(/[\\/]/).filter(Boolean).pop() || ruta;
}

/**
 * La extensión, sin punto y tal como viene, o vacía si el nombre no la trae.
 * Un nombre que empieza por punto no es una extensión. Cada pantalla decide su
 * caja y su respaldo («Archivo», «.md»…): eso es texto de interfaz, no dato.
 */
export function extensionDe(ruta: string) {
  const n = nombreDe(ruta);
  const i = n.lastIndexOf(".");
  return i > 0 ? n.slice(i + 1) : "";
}

/**
 * Lo que se ejecutó, sin el envoltorio del shell **ni el `cd` que lo precede**.
 *
 * Son dos envoltorios y el motivo es el mismo: enseñar la fontanería en el sitio
 * donde va lo que el agente decidió hacer.
 *
 * - Codex no manda el comando: manda `/bin/zsh -lc "…"` con el comando dentro.
 *   Verificado sobre un turno real.
 * - Y **el 52 % de los comandos empieza por `cd "<ruta absoluta>" && `**, medido
 *   sobre 14 sesiones. Ese prefijo ocupa 137 caracteres de mediana —la ruta de
 *   una carpeta de trabajo de Terminus es larga— y es idéntico en todas las
 *   filas de la misma tarea: no distingue una de otra y desplaza a la derecha lo
 *   único que sí.
 *
 * **Se quita al pintar, no al guardar.** El rastro es lo que el gate aprueba, y
 * ahí el comando tiene que ser el que se ejecutó de verdad. Lo que se recorta es
 * la lectura.
 *
 * El `cd` se quita **solo cuando hay algo detrás**: un `cd` suelto es lo que el
 * agente hizo y se enseña tal cual.
 */
export function comando(cmd: string) {
  const envuelto = /^\S*(?:sh|bash|zsh)\s+-[a-z]*c\s+(["'])([\s\S]*)\1\s*$/.exec(cmd.trim());
  const desnudo = (envuelto ? envuelto[2] : cmd).trim();
  const conCd = /^cd\s+(?:"[^"]*"|'[^']*'|\S+)\s*&&\s*([\s\S]+)$/.exec(desnudo);
  return (conCd ? conCd[1] : desnudo).trim();
}

/**
 * La cabecera de una fila: el verbo en prosa y el sujeto como dato de máquina.
 *
 * Van separados porque son dos cosas distintas y el sistema visual las distingue: el
 * verbo se lee, el sujeto es una ruta o un comando y va en mono. «Leyó» +
 * `Chat.tsx`, no «tool_use».
 */
export function resumen(fila: Fila): { verbo: string; sujeto: string | null } {
  const n = fila.pasos.length;
  const [uno] = fila.pasos;
  const objetivo = uno.objetivo;

  switch (fila.clase) {
    case "leer":
      return n === 1
        ? { verbo: t("common.steps.read.one"), sujeto: objetivo && nombreDe(objetivo) }
        : { verbo: t("common.steps.read.many", { count: n }), sujeto: null };
    case "buscar":
      return n === 1
        ? { verbo: t("common.steps.search.one"), sujeto: objetivo }
        : { verbo: t("common.steps.search.many", { count: n }), sujeto: null };
    case "editar":
      return n === 1
        ? { verbo: verboDeEdicion(uno.nombre), sujeto: objetivo && nombreDe(objetivo) }
        : { verbo: t("common.steps.edit.many", { count: archivosDistintos(fila.pasos) }), sujeto: null };
    case "ejecutar":
      return {
        verbo: t("common.steps.run"),
        sujeto: objetivo && comando(objetivo).split("\n")[0],
      };
    case "web":
      return n === 1
        ? { verbo: t("common.steps.web.one"), sujeto: objetivo }
        : { verbo: t("common.steps.web.many", { count: n }), sujeto: null };
    case "plan":
      return {
        verbo:
          n === 1
            ? t("common.steps.plan.one")
            : t("common.steps.plan.many", { count: n }),
        sujeto: null,
      };
    case "otro":
      return n === 1
        ? { verbo: t("common.steps.other.one", { tool: uno.nombre }), sujeto: objetivo }
        : { verbo: t("common.steps.other.many", { count: n }), sujeto: null };
    // Si decidió la persona el verbo va en segunda persona: es lo que distingue
    // una decisión tuya de un paso del agente sin más rótulo.
    case "permiso":
      return {
        verbo: uno.decidio
          ? uno.permitido
            ? t("common.steps.permission.allowed_by", { who: uno.decidio, tool: uno.nombre })
            : t("common.steps.permission.denied_by", { who: uno.decidio, tool: uno.nombre })
          : uno.permitido
            ? t("common.steps.permission.allowed", { tool: uno.nombre })
            : t("common.steps.permission.denied", { tool: uno.nombre }),
        sujeto: objetivo && comando(objetivo).split("\n")[0],
      };
    // Estos tres traen su propio texto y no se agrupan.
    default:
      return { verbo: objetivo ?? "", sujeto: null };
  }
}

/** Una fila de un solo paso que sigue corriendo se nombra en presente, como su loader. */
export function rotuloDeFila(fila: Fila): { verbo: string; sujeto: string | null } {
  const [uno] = fila.pasos;
  return fila.pasos.length === 1 && uno.corriendo ? enCurso(uno) : resumen(fila);
}

/**
 * Lo mismo que [`resumen`], **en presente**: lo que está pasando ahora mismo.
 *
 * Va aquí y pegado a su gemelo por un motivo concreto: son la misma tabla de
 * clases dicha dos veces, y separarlas es cómo una gana un caso que la otra no
 * tiene. Lo que las distingue no es el tiempo verbal por gusto — «Leyó
 * Chat.tsx» es el rastro de lo que ya ocurrió, y «Leyendo Chat.tsx» es la única
 * prueba que tiene delante quien está esperando de que la app no se colgó.
 *
 * No agrupa, y no puede: un paso en curso es exactamente uno.
 */
export function enCurso(paso: Paso): { verbo: string; sujeto: string | null } {
  const objetivo = paso.objetivo;
  switch (paso.clase) {
    case "leer":
      return { verbo: t("common.steps.reading"), sujeto: objetivo && nombreDe(objetivo) };
    case "buscar":
      return { verbo: t("common.steps.searching"), sujeto: objetivo };
    case "editar":
      return {
        verbo: gerundioDeEdicion(paso.nombre),
        sujeto: objetivo && nombreDe(objetivo),
      };
    case "ejecutar":
      return {
        verbo: t("common.steps.running"),
        sujeto: objetivo && comando(objetivo).split("\n")[0],
      };
    case "web":
      return { verbo: t("common.steps.web_searching"), sujeto: objetivo };
    case "plan":
      return { verbo: t("common.steps.planning"), sujeto: null };
    default:
      return { verbo: t("common.steps.using", { tool: paso.nombre }), sujeto: objetivo };
  }
}

/**
 * Cuánto lleva, en la misma forma con la que se cierra.
 *
 * **Es el dato que desmiente «se congeló».** Un rótulo que no cambia se lee como
 * una pantalla muerta por muy animado que esté su punto; un número que sube es lo
 * único que prueba que algo sigue ocurriendo. Y es el mismo formato con el que el
 * turno cierra —«Trabajó durante 1m 4s»— para que el número no salte al acabar.
 */
export function formatearDuracion(ms: number) {
  const segundos = Math.floor(ms / 1000);
  if (segundos < 1) return t("common.duration.under_second");
  const minutos = Math.floor(segundos / 60);
  const resto = segundos % 60;
  return minutos > 0
    ? t("common.duration.min_sec", { minutes: minutos, seconds: resto })
    : t("common.duration.sec", { seconds: resto });
}

function gerundioDeEdicion(nombre: string) {
  if (nombre === "Write") return t("common.steps.writing");
  if (nombre === "file_change") return t("common.steps.changing");
  return t("common.steps.editing");
}

/** Escribir un archivo entero y editar un trozo no son el mismo acto. */
function verboDeEdicion(nombre: string) {
  if (nombre === "Write") return t("common.steps.write.one");
  if (nombre === "file_change") return t("common.steps.change.one");
  return t("common.steps.edit.one");
}
