import type { HandlerDefinition } from "./model";

const known = new Map<string, HandlerDefinition[]>();

export function lastRoster(project: string): HandlerDefinition[] | undefined {
  return known.get(project);
}

export function rememberRoster(project: string, handlers: HandlerDefinition[]): void {
  known.set(project, handlers);
}

export function forgetRosters(): void {
  known.clear();
}
