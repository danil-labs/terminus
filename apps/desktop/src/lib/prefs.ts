import { type Accessor, createSignal } from "solid-js";

/**
 * Preferencias de esta máquina que sobreviven a cerrar la app: un solo
 * mecanismo para el ancho de columnas, el colapso del sidebar y lo demás que se
 * ajusta. `localStorage` alcanza: nada de esto viaja ni se commitea.
 *
 * La carpeta de proyectos no vive aquí: es de un workspace, no de esta máquina
 * — dos clientes apuntan a carpetas distintas y una preferencia global las
 * mezclaría. La clave `root` se lee una vez al arrancar, solo para que la
 * migración sepa a dónde apuntaba la app anterior.
 */
const NS = "harness.layout.";

export function leerPref<T>(clave: string, porOmision: T): T {
  try {
    const crudo = localStorage.getItem(NS + clave);
    return crudo === null ? porOmision : (JSON.parse(crudo) as T);
  } catch {
    return porOmision;
  }
}

export function escribirPref(clave: string, valor: unknown) {
  try {
    localStorage.setItem(NS + clave, JSON.stringify(valor));
  } catch {
    // Sin almacenamiento la app sigue: se pierde la preferencia, no el trabajo.
  }
}

export function hayPref(clave: string): boolean {
  try {
    return localStorage.getItem(NS + clave) !== null;
  } catch {
    return false;
  }
}

export function borrarPref(clave: string) {
  try {
    localStorage.removeItem(NS + clave);
  } catch {
    // Sin almacenamiento no hay nada que borrar.
  }
}

/** Las claves guardadas que empiezan por `prefijo`, sin el espacio de nombres. */
export function prefsQueEmpiezan(prefijo: string): string[] {
  try {
    const claves: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const clave = localStorage.key(i);
      if (clave?.startsWith(NS + prefijo)) claves.push(clave.slice(NS.length));
    }
    return claves;
  } catch {
    return [];
  }
}

/**
 * Una señal que se acuerda, con la forma de `createSignal`.
 *
 * Escribe al asignar y no dentro de un efecto: un efecto podría rastrear además
 * lecturas accidentales.
 */
export function createPref<T>(
  clave: string,
  porOmision: T,
): [Accessor<T>, (valor: T) => void] {
  const [valor, setValor] = createSignal<T>(leerPref(clave, porOmision));

  return [
    valor,
    (siguiente: T) => {
      setValor(() => siguiente);
      escribirPref(clave, siguiente);
    },
  ];
}

