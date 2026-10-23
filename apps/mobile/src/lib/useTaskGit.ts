import { useEffect, useMemo, useRef, useState } from "react";
import { AppState } from "react-native";
import type { Host } from "./hosts";
import { type GitBook, gitAsks, gitAsksKey, staleGit, withGitAnswer } from "./taskGit";

/** Cada cuánto se relee mientras la lista está a la vista: el CI cambia en minutos, no en segundos. */
const EVERY_MS = 30_000;

/**
 * El git de las tarjetas visibles, por `host/id`. Una llamada por máquina y
 * carpeta (`gitAsks`), al cambiar lo visible y cada 30 s con la app al frente.
 * Leer nunca enciende: a una máquina que no está encendida no se le pregunta y
 * lo suyo queda viejo (`stale`).
 */
export function useTaskGit(hostOf: (id: string) => Host | undefined, visible: readonly { host: string; workspace: string; folder: string; id: string }[]): GitBook {
  const [book, setBook] = useState<GitBook>({});
  const asks = useMemo(() => gitAsks(visible), [visible]);
  const key = gitAsksKey(asks);
  // Lo último pedido y la flota, sin volver a preguntar en cada render: lo
  // visible y `hostOf` cambian de objeto, no de contenido (`key` lo resume).
  const latest = useRef({ asks, hostOf });
  latest.current = { asks, hostOf };
  useEffect(() => {
    let live = true;
    const read = () => {
      const { asks, hostOf } = latest.current;
      for (const ask of asks) {
        const host = hostOf(ask.host);
        if (!host || host.power() !== "on") {
          setBook((b) => staleGit(b, ask.host, ask.priority));
          continue;
        }
        host
          .call<unknown>("list_session_git", ask.workspace, { project: ask.project, remote: true, priority: ask.priority })
          .then(({ value }) => live && setBook((b) => withGitAnswer(b, ask.host, value)))
          .catch(() => live && setBook((b) => staleGit(b, ask.host, ask.priority)));
      }
    };
    read();
    const timer = setInterval(() => AppState.currentState === "active" && read(), EVERY_MS);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [key]);
  return book;
}
