# Revisión documental: transición a Danil

Fecha: 2026-10-31. Base: `fa8f850`; código del cliente comprobado: `3e7649f9`.
Plataforma: Linux x86_64. Alcance: documentación modificada por la transición
CLI y marca, no una auditoría completa del monorepositorio.
La persona autorizó la migración; architect aprobó conservar las identidades
instaladas y revisó el cliente hasta `4a8189bf`. El delta posterior conserva
ese alcance y requiere la revisión final junto al motor.

No había una evaluación anterior en este directorio. Medición: `AGENTS.md`
de raíz, escritorio y móvil tienen 45, 74 y 90 líneas; README, guía CLI,
desarrollo, guards y README npm suman 599 líneas antes de este registro.
La guía CLI tiene 82 líneas y 4659 bytes. No se cambió lo autocargado.

| Criterio | Estado | Evidencia en el alcance |
|---|---|---|
| Instrucciones de raíz | pasa | [Raíz](../../../AGENTS.md) define dev primero; [escritorio](../AGENTS.md) aplica las reglas del cliente. |
| Alcance por ámbito | pasa | Guías separadas de front, scripts, tests y móvil, leídas antes de editar. |
| Invariantes | pasa | [CLI](danil-cli.md) enumera identidad, datos, RPC, rutas y actualización que se conservan. |
| Arquitectura | pasa | [Motor](engine-client.md) y guía CLI separan ventana, motor, launchers e integración pendiente. |
| Decisiones | pasa | Encargo autorizado del 31 de octubre; dictamen architect `0y6sqg30`: conserva productName y binario físico. |
| Arranque | pasa | README enlaza la guía; `node apps/desktop/scripts/cli-path.mjs --help` ejecutado desde la raíz. |
| Límites operativos | pasa | Guía declara colisiones, propiedad, PATH manual, pin y comprobaciones nativas pendientes. |
| Coherencia global | sin comprobar | No se auditó toda la documentación anterior. El encargo exige dev y prohíbe Actions/publicación. |
| Navegación | pasa | README, desarrollo y README npm enlazan la guía CLI; guard doc-paths pasa. |
| Presupuesto global | sin comprobar | Se midieron líneas; no se definió ni auditó un presupuesto global de autocarga. |
| Controles | pasa | cli-path y cli-forward ejecutan código real; la guía separa simulación de ventana nativa. |
| Secretos | pasa | Documentos modificados usan placeholders y rutas públicas; no se añadieron credenciales. |
| Construcción | pasa | `CARGO_BUILD_JOBS=2 pnpm window:build` terminó con código 0 en Linux. |
| Pruebas completas | pasa | `CARGO_BUILD_JOBS=2 pnpm verify` terminó con código 0 en Linux, 730 s; incluye Cargo fmt/check/clippy/test. |
| Verificación | pasa | [Guards](guards.md) documenta la cadena y la cobertura del instalador. |
| Estilo | pasa | Lint del instalador y sus pruebas, doc-paths, comments y git diff --check pasan. |

**14 pasan · 0 fallan · 2 sin comprobar.**

QA nativo verificó título, pie y Configuración con Danil; reiniciar conservó
workspace e idioma. El principal repitió 32/32 comprobaciones E2E del motor.
La entrega del motor registra además 378/378 de runtime y 145/145 de arranque;
se inspeccionaron sus resultados JSON. cli-path y cli-forward suman 8/8 con
26 raíces del motor fijado. El delta final de PATHEXT vacío se comprobó aparte
con 6/6 pruebas del instalador y lint, después del paso correspondiente de la
cadena; no cambió Rust ni la UI.

Pendientes de integración: revisión arquitectónica final del motor/cliente;
manifest y checksums multiplataforma antes de cambiar el pin. No se autorizaron
publicación, instalaciones productivas ni pruebas de actualización instalada.
Los resultados de Linux no acreditan cmd, PowerShell, Git Bash, macOS ni móvil
nativo. Los nombres de distribución Terminus siguen siendo intencionales.
