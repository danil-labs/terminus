import { For } from "solid-js";
import Cambios from "./Changes";
import type { CodeRange } from "../../lib/model";

/**
 * Lo que cambió **un turno**, debajo de ese turno. Es el mismo componente que
 * la pestaña Código (`Cambios`), con los archivos plegados y el rango del
 * turno: dos renderizadores del mismo diff divergen (ver `chat/DiffBlock.tsx`).
 *
 * **El rango, no el acumulado.** Cada turno guarda las dos fotos que lo
 * encierran (`sessions::CodeRange`) y el diff se recalcula entre ellas; el
 * acumulado contra la rama le atribuiría a este turno lo que hicieron los de
 * después.
 *
 * Un bloque por árbol, solo de los que cambiaron (`development::rangos` deja
 * fuera el resto), y con su propio scroll: quince archivos abiertos dentro de
 * un turno entierran la conversación.
 *
 * **El marco lo pinta `Cambios` y no este `For`**: el diff se pide dentro de
 * `Cambios`, así que solo ahí se sabe si hay algo que enmarcar — un rango sin
 * archivos dejaría una caja con borde vacía por copia de trabajo abierta.
 *
 * Cada fila abre el archivo como pestaña del centro (`App.tsx` ·
 * `abrirArchivo`). **La clave del árbol se ata aquí y no se adivina de la
 * ruta**: varios árboles pueden tener el mismo `README.md`, y `r.tree` es el
 * dato que `pestanas::idDeArchivo` necesita para no confundir dos pestañas.
 */
export default function CambiosDelTurno(props: {
  project: string;
  session: string;
  code: CodeRange[];
  /**
   * Abrir uno de estos archivos es abrir una pestaña del centro; lo hace
   * `App.tsx`, que es quien tiene la tira. El árbol lo pone este bloque.
   */
  onAbrir: (arbol: string, ruta: string) => void;
}) {
  return (
    <For each={props.code}>
      {(r) => (
        <Cambios
          project={props.project}
          session={props.session}
          origen={{
            tipo: "turno",
            arbol: r.tree,
            before: r.before,
            after: r.after,
          }}
          alto="max-h-[420px]"
          marco="overflow-hidden rounded-md border border-border"
          onAbrir={(ruta) => props.onAbrir(r.tree, ruta)}
        />
      )}
    </For>
  );
}
