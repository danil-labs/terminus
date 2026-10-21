type Task = {
  id: string;
  parent: string | null;
  archived?: boolean | null;
  chat_de_agente?: boolean;
};

/** Chat persistente de un agente; la vista por agente puede incluirlo. */
export function esChatDeAgente(s: { chat_de_agente?: boolean }): boolean {
  return !!s.chat_de_agente;
}

/** Una tarea con sus encargos, cada uno con los suyos: los CLIs no topan en el segundo nivel. */
export type Rama<T> = { tarea: T; hijas: Rama<T>[] };

const mismasHijas = <T,>(a: Rama<T>[], b: Rama<T>[]) =>
  a.length === b.length && a.every((h, i) => h === b[i]);

/** Toda rama del árbol previo por id, sin importar a qué profundidad esté. */
function indexar<T extends Task>(ramas: Rama<T>[], en = new Map<string, Rama<T>>()) {
  for (const rama of ramas) {
    en.set(rama.tarea.id, rama);
    indexar(rama.hijas, en);
  }
  return en;
}

/**
 * Es raíz la tarea cuyo padre no está en este grupo; sin eso, una hija cuyo padre
 * quedó en el otro grupo desaparecería de la lista.
 * `previas` conserva cada rama que no cambió, a cualquier nivel: `For` compara por referencia.
 */
export function taskTree<T extends Task>(
  sessions: T[],
  archived: boolean | null,
  previas?: Rama<T>[],
  includeChats = false,
): Rama<T>[] {
  const visible = sessions.filter(
    (session) =>
      (archived === null || (session.archived === true) === archived) && (includeChats || !esChatDeAgente(session)),
  );
  const ids = new Set(visible.map((session) => session.id));
  const hijasDe = new Map<string, T[]>();
  const raices: T[] = [];
  for (const session of visible) {
    if (session.parent && ids.has(session.parent) && session.parent !== session.id) {
      const hermanas = hijasDe.get(session.parent) ?? [];
      hermanas.push(session);
      hijasDe.set(session.parent, hermanas);
    } else {
      raices.push(session);
    }
  }
  const antes = previas?.length ? indexar(previas) : undefined;
  // Un ciclo de padres no tiene raíz; `visto` evita pintar dos veces una tarea.
  const visto = new Set<string>();
  const armar = (tarea: T): Rama<T> => {
    visto.add(tarea.id);
    const hijas = (hijasDe.get(tarea.id) ?? [])
      .filter((h) => !visto.has(h.id))
      .map(armar);
    const anterior = antes?.get(tarea.id);
    return anterior && anterior.tarea === tarea && mismasHijas(anterior.hijas, hijas)
      ? anterior
      : { tarea, hijas };
  };
  return raices.map(armar);
}

/** Todas las tareas de una rama por debajo de su raíz, a cualquier profundidad. */
export function descendientes<T>(rama: Rama<T>): T[] {
  return rama.hijas.flatMap((h) => [h.tarea, ...descendientes(h)]);
}
