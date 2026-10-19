# Terminus móvil: guía del área

Aplica [AGENTS.md](../../AGENTS.md). App de Expo (React Native, TypeScript) para
iOS y Android: un control remoto de Terminus, no un Terminus completo. La
arquitectura y el estado están en [docs/mobile.md](docs/mobile.md).

Es un proyecto aparte de la raíz: tiene su `package.json` y su
`package-lock.json` con npm, y las comprobaciones del escritorio (`pnpm verify`) no
lo cubren.

## Comandos

Desde `apps/mobile/`:

```bash
npm install
npm run bridge        # bridge contra el motor del lab (apps/desktop/.engine/lab/data)
npm start             # Metro; Expo Go en el teléfono o el simulador
npm run typecheck     # tsc --noEmit
npm run doctor        # expo-doctor
```

El motor del lab se arranca desde la raíz con `pnpm engine:download` y
`node apps/desktop/scripts/engine.mjs engine`.

## Expo cambia en cada SDK

El proyecto usa el SDK que fija `package.json` (`expo`). Antes de usar una API
de Expo, React Native o EAS, consulta la documentación de esa versión
(`https://docs.expo.dev/versions/v<major>.0.0/`) o el índice
`https://docs.expo.dev/llms.txt`; no la escribas de memoria. Las dependencias
se agregan con `npx expo install <paquete>`, que elige la versión compatible.

## Reglas

- La app solo habla con el bridge (`src/lib/bridge.ts`). El bridge solo deja
  pasar los comandos de su lista `CLI`/`INVOKE` (`bridge/bridge.mjs`): un
  comando nuevo se agrega ahí a propósito, nunca un pase genérico al motor.
- Los nombres de comandos y campos son los del motor (`task list`,
  `respond_permission`, `encargado`); no se traducen en la app.
- Todo texto que se lee viene de `src/lib/i18n.ts`, en `es` y `en`.
- Lo que comparte con el escritorio viene de `packages/` en la raíz: colores, estado de
  tarea, íconos y frases de `@terminus/design`, y tipos y comandos del bridge de
  `@terminus/protocol`. No se copian aquí: el guard `shared-design` compara
  `@terminus/design` con el escritorio.
- El estado de una tarea se pinta solo con `src/ui/TaskStatus.tsx`, sobre
  `@terminus/design`; no se inventan marcas propias.
- `package.json` fija `react-dom` a la versión de `react` en `overrides`: sin
  eso npm no resuelve ninguna instalación nueva.
- Nunca apuntes el bridge a los datos de un Terminus instalado: usa el lab.
- No agregues pruebas unitarias de pantallas. Se comprueba en el simulador o en
  un teléfono contra el motor del lab, y se dice qué se tocó y qué no.
