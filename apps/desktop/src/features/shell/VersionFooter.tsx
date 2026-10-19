import { Show, createSignal, onMount } from "solid-js";
import { getVersion } from "@tauri-apps/api/app";

/**
 * La versión instalada, en el extremo derecho de la barra inferior.
 *
 * **Se lee de un vistazo, sin entrar a Configuración.** El número que dice «qué
 * traigo instalado» tiene que estar a la vista, y la barra inferior es chrome
 * persistente de la ventana, también con el riel colapsado.
 *
 * **El número lo da el binario, no un valor escrito en el front.**
 * `getVersion()` devuelve la versión con la que se compiló la app (la de
 * `tauri.conf.json`), así que no hay una segunda copia que se quede vieja al
 * subir la versión.
 *
 * **En una ventana angosta se recorta ella, no lo que acompaña**: el consumo y
 * su botón son una misma acción, y la versión no puede empujarlos fuera de la
 * franja.
 *
 * **No lleva `ml-auto` ni tope propio: eso lo decide quien la envuelve.**
 * Anclándose ella sola al extremo derecho del pie, todo lo que se pusiera detrás
 * quedaría fuera del ancla; hoy el grupo entero —puertos, tema y esto— cuelga de
 * un contenedor que sí lo hace (`UsageBar`). **Nada entre medias debe crecer**:
 * estirar el consumo con un `flex-1` para llevarla a la esquina mueve el botón
 * de recargar, que acaba a dos palmos del número que recarga.
 */
export default function PieVersion() {
  const [version, setVersion] = createSignal<string | null>(null);

  onMount(() => {
    // Si por lo que sea no se puede leer, no se pinta nada: un pie sin número es
    // mejor que un pie con un error.
    void getVersion()
      .then(setVersion)
      .catch(() => {});
  });

  return (
    <Show when={version()}>
      {(v) => (
        <p
          class="m-0 min-w-0 shrink truncate px-2 text-right font-mono text-[0.6875rem] text-neutral-500"
          title={`Terminus ${v()}`}
        >
          Terminus {v()}
        </p>
      )}
    </Show>
  );
}
