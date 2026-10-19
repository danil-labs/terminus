/**
 * Destinatarios: `@encargado` nombra a quién se le entrega el mensaje.
 *
 * Es otra especie que `@archivo` o `@tarea`, que son material que entra al
 * prompt. Viven en listas separadas y con tipos separados, y el compilador es
 * quien sostiene que un destinatario nunca se cuele como contexto
 * (`docs/specs/handler-mentions.md`).
 *
 * La aritmética de intervalos se importa de `taskMentions.ts`: las dos
 * gramáticas comparten convención de `start` y `end`.
 */
import type { HandlerStatus } from "./model.ts";
import type { Trigger } from "./mentions.ts";
import {
  editMentions,
  editSpans,
  insertReference,
  type MentionDraft,
  type MentionTarget,
  mentionLabel,
  shiftSpans,
  type TextEdit,
  trimOffset,
} from "./taskMentions.ts";

/**
 * Dónde se contesta un mensaje, cuando no es aquí (`sessions::ReplyTo`). Es del
 * sobre y no del texto: viaja con el mensaje y el reenvío la conserva.
 */
export type ReplyTo = { folder: string; task: string };

/**
 * La tarea que escribió un mensaje por el CLI (`sessions::SenderTask`), como era
 * al escribirlo: su título y su agente son la cara del globo.
 */
export type SenderTask = {
  folder: string;
  task: string;
  title: string;
  agent: string;
  model?: string | null;
};

/** El nombre del encargado, y el intervalo de su etiqueta en el texto de la caja. */
export type Recipient = { name: string; start: number; end: number; text: string };

/** Lo que hay escrito en la caja: un texto, el material referido y a quién va. */
export type RecipientDraft = MentionDraft & { recipients?: Recipient[] };

/** Espacio de ids del menú, sin choque con `task-`, `folder-`, `portfolio-` ni una ruta. */
export function recipientId(name: string): string {
  return `handler-${name}`;
}

export function recipientLabel(name: string): string {
  return mentionLabel(name, "handler");
}

export function editRecipients(before: RecipientDraft, text: string, edit?: TextEdit): Recipient[] {
  return editSpans(before.text, before.recipients ?? [], text, edit);
}

/** Escribir alrededor desplaza las dos listas por igual, o una se queda atrás. */
export function editDraft(before: RecipientDraft, text: string, edit?: TextEdit): RecipientDraft {
  return {
    text,
    task_mentions: editMentions(before, text, edit),
    recipients: editRecipients(before, text, edit),
  };
}

export function trimDraft(before: RecipientDraft): RecipientDraft {
  const offset = trimOffset(before.text);
  return {
    text: before.text.trim(),
    task_mentions: shiftSpans(before.task_mentions ?? [], offset),
    recipients: shiftSpans(before.recipients ?? [], offset),
  };
}

export function insertRecipient(before: RecipientDraft, trigger: Trigger, name: string, label: string): RecipientDraft {
  const text = before.text.slice(0, trigger.from) + label + " " + before.text.slice(trigger.to);
  const edit = { start: trigger.from, end: trigger.to };
  return {
    text,
    task_mentions: editMentions(before, text, edit),
    recipients: [...editRecipients(before, text, edit), {
      name, start: trigger.from, end: trigger.from + label.length, text: label,
    }].sort((a, b) => a.start - b.start),
  };
}

/** Insertar material también corre a los destinatarios que quedaban detrás. */
export function insertMention(before: RecipientDraft, trigger: Trigger, target: MentionTarget, label: string): RecipientDraft {
  const next = insertReference(before, trigger, target, label);
  return {
    ...next,
    recipients: editRecipients(before, next.text, { start: trigger.from, end: trigger.to }),
  };
}

/**
 * Un encargado alcanzable desde la caja, tal como lo necesita el menú.
 *
 * Sale de la lista que el riel ya invoca (`list_encargados`), con la presencia
 * que `list_encargado_status` publica si está a mano: `undefined` no es un
 * estado, es «todavía no se sabe», y la cara se pinta despierta igual.
 */
export type RecipientCandidate = { name: string; description: string; status?: HandlerStatus };

/**
 * Los encargados que casan con lo tecleado, el exacto primero.
 *
 * Mismo orden que `searchTasks` y `searchPlaces` —exacto, luego prefijo, luego
 * contiene—: tres criterios distintos en tres grupos del mismo menú se leen
 * como que el menú no tiene ninguno.
 */
export function searchRecipients(candidates: readonly RecipientCandidate[], query: string): RecipientCandidate[] {
  const rank = (c: RecipientCandidate) => {
    const name = c.name.toLowerCase();
    return name === query ? 0 : name.startsWith(query) ? 1 : 2;
  };
  return candidates.filter(c => c.name.toLowerCase().includes(query))
    .sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
}
