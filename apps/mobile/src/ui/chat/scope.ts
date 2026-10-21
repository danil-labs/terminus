import { createContext, useContext } from "react";
import type { Host } from "../../lib/hosts";

/** De qué tarea es el mensaje: lo que piden las imágenes, archivos y visualizaciones para leerse. */
export type ChatScope = { host: Host; hostId: string; workspace: string; folder: string; session: string };

export const ChatScopeContext = createContext<ChatScope | null>(null);
export const useChatScope = () => useContext(ChatScopeContext);
