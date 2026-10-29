# Integración empresarial de Terminus y Radiant

Fecha: 2026-10-27. Encargo: implementar la integración y decidir el diseño sin
interrumpir a la persona. Revisión: `/plan-eng-review` de garrytan/gstack,
instrucciones oficiales recuperadas porque no estaban instaladas en este host.

## Estado de entrega

La integración está desplegada en Computers y Radiant. Los cinco integrantes
de Danil tienen una vinculación explícita de identidad y workspace corporativo;
el inventario se consulta en producción. La recuperación histórica requiere
habilitación por workspace, conserva el avance y usa las mismas claves que los
reportes nuevos. Solo lee el registro de consumo del workspace autenticado;
excluye otros workspaces, transcripciones y costos schema 1 acumulados.

Esta entrega fija el motor 3ecb9a7 en las cuatro plataformas sin modificar el
contrato del cliente. Sus pruebas generales pasan en Linux (379), macOS ARM (384),
macOS Intel (404) y Windows (531). La prueba central usa el motor y el
receptor reales, incluye un registro de 40 días, fallos de red y reinicio sin
duplicar. Radiant conserva su retención de 13 meses; los endpoints ordinarios
siguen limitando los reportes atrasados a 30 días.

Las VM actualizadas de Alejandro y Mauricio completaron el recorrido de sus
archivos históricos en producción sin aumentar los totales ya importados. La
VM de Alberto conserva su escritor activo y tiene la actualización preparada
para el cambio cuando quede libre. Los equipos personales necesitan recibir
el cliente con este motor para iniciar su recuperación automática.

Las secciones siguientes conservan el plan y las comprobaciones de la primera
implementación local, anteriores a la activación en producción.

## Plan original

Vincular identidades Danil y WorkOS, mostrar consumo por empleado, modelo y
máquina en Radiant, agregar actividad de VM y herramientas, después alertas de
presupuesto y controles en el punto de ejecución. El piloto es Danil mismo.
Un turno iniciado en web debe aparecer una sola vez con su atribución correcta.

## Alcance decidido

Entrega vertical de observabilidad: motor → Computers → Radiant, sin login
Radiant en Terminus web ni en cada motor. Vinculación explícita entre cuenta y
persona Danil, usuario/organización WorkOS, workspaces y fecha de activación.
El panel empresarial muestra consumo por persona, máquina, workspace y cuenta
IA opaca, con duración y conteos de herramientas observados. La vía directa de
escritorio conserva compatibilidad; no se envía el mismo turno por ambas vías.

Se preserva la decisión `radiant-out-of-terminus-app.md` del 2026-10-21. La
primera propuesta usaba solo la sesión Radiant del motor: no cubría Terminus
web. La revisión detectó esa frontera y corrigió el alcance antes de cerrar
la implementación. El canje WorkOS → Danil ya existente no se usa como
supuesto de que toda sesión Danil tiene sesión empresarial.

## Binding decisions

- La persona delegó decisiones e implementación: «decide tú todo».
- WorkOS conserva membresía empresarial; Supabase conserva cuenta Danil.
- Sin migración de autenticación, unión por correo ni acceso nuevo a máquinas.
- Reporte central desactivado por defecto; configuración de operador explícita.
- No enviar filas anteriores a la activación de la vinculación.
- Tiempo de tareas no equivale a factura de VM; costo ausente sigue ausente.
- Sin prompts, argumentos, rutas, resultados o identificadores crudos de cuenta IA.
- Contrato RPC congelado sin cambios. Commits locales; sin despliegue o PR.

## What already exists

Host: `workspace/radiant/usage_report.rs`, cola v1 atribuida a WorkOS;
`runtime/chat/closing.rs`, consumo y tramos persistidos; `danil/`, credencial de
máquina y ControlPlane. Computers: autenticación de máquina, dueña, membresías
`account_users`, workspaces vivos y `computer_workspace_links`. Radiant:
`enterprise/usage.py`, almacén, política y retención; `admin.py`, autorización
empresarial y consola. No existe una fuente verificada de facturación de VM.

## Premisas y evidencia

| Premisa | Evidencia | Veredicto |
|---|---|---|
| Motor tiene consumo y herramientas | `usage_report.rs`, `closing.rs` | comprobado y E2E |
| Danil web implica sesión Radiant | decisión guardada y autoridades distintas | falso; vía central necesaria |
| Computers puede atestar máquina/dueña | auth existente, [control de consumo de Computers](https://github.com/danil-labs/computers/blob/main/src/usage.ts), workerd | comprobado |
| WorkOS mantiene autoridad | `admit`/`effective_access`, pruebas de baja | comprobado con proveedor simulado |
| Hay costo completo de VM | ningún contrato revisado lo suministra | falso; fuera de alcance |
| Configuración y login de producción funcionan | no se desplegó | unverified=1 |

## Scope Challenge

Se conserva el objetivo empresarial por etapas verificables. Esta entrega
reutiliza tres servicios existentes y sus almacenes; no agrega un proveedor de
identidad, proxy de modelos ni backend nuevo. Cuatro repositorios, cuatro
commits locales, sin PR ni cadena remota de merges. Presupuestos vinculantes y
facturación de infraestructura necesitan fuentes y controles propios.

## Architecture review

[INFORMATIONAL] (confidence: 10/10) La sesión Radiant del motor no cubre la web.
Remedio implementado: credencial de máquina → Computers → receptor acotado de
servicio; WorkOS vuelve a verificar membresía y política al recibir. Token de
servicio y JWT de persona tienen audiencias separadas.

[INFORMATIONAL] (confidence: 9/10) Resolver cuenta al enviar reatribuye turnos.
Remedio: captura al lanzamiento, cola sin credenciales con destino original,
sesiones opacas separadas por máquina/instalación y claves estables por modelo.

[INFORMATIONAL] (confidence: 9/10) Una vinculación nueva podría publicar una
cola previa. Remedio: `since` obligatorio, validación de membresía Danil actual,
workspace ligado a la máquina y rechazo de filas anteriores a la activación.

Dispositions: resueltas por la delegación explícita; no hay decisiones abiertas.

## Code quality review

[INFORMATIONAL] (confidence: 9/10) `INSERT INTO usage VALUES` depende del orden
físico. Remedio: columnas explícitas, contexto separado transaccional,
compatibilidad v1, retención conjunta y sin enriquecimiento retrospectivo.

Se reutilizan gate, rate limit y cola existente. Esquema versionado compartido
por Python/Rust; validación allowlist adicional antes de reenviar desde Worker.
No se crea infraestructura común entre lenguajes ni copia de autoridades.

## Test review

[INFORMATIONAL] (confidence: 9/10) La nueva frontera necesita pruebas de
suplantación, bajas y reinicio, además de la respuesta feliz. Implementadas:

```text
Turno web -> relay -> motor (camino existente)
  captura origen/cuenta -> cierre -> cola durable
  + sesion Radiant previa -> v2 directo [E2E: captura y cambio de persona]
  |   404/405 -> v1; 403 -> no downgrade [E2E]
  + sin sesion Radiant -> consulta politica Computers
      off/404 -> descarta sin publicar consumo [E2E]
      on -> POST con credencial de maquina
        Worker -> dueña + membresia Danil + vinculo + since [workerd]
          -> sobre con actor fijado por servidor
          -> Radiant servicio -> scope + WorkOS + politica [pytest]
          -> SQLite -> duplicados/conflictos/retencion [pytest]
          -> desglose por persona/maquina/cuenta/tools [UI + navegador]
      fallo -> conserva; reinicio -> entrega unica [E2E motor/receptor reales]
```

El laboratorio central simula Computers, WorkOS y CLI, pero usa motor y receptor
Radiant reales. El Worker se comprueba por separado en workerd. No acredita
login real de proveedores, desplegar los tres servicios ni cargar producción.
No se retiran pruebas; sin cambios de prompts que necesiten eval.

## Performance review

SQLite agrega por organización/ventana con índices existentes, sin leer
transcripciones para el panel. Desgloses acotados a 1000 filas, con truncamiento
explícito; totales completos. Reportes de 150 líneas/60 000 bytes; Worker con
plazo de 15 segundos y sin redirects. Cola central de 10 000 claves, cuarentena
y reintento; política desactivada cacheada cinco minutos. No hay benchmark ni
promesa de escala de producción.

## NOT in scope

- Migración Supabase/WorkOS y administración autoservicio de la vinculación.
- Factura de VM, horas encendidas, almacenamiento, red y conciliación financiera.
- Presupuestos vinculantes, alertas monetarias completas y apagados automáticos.
- Auditoría forense fuera del motor o turnos muertos sin reporte de tokens.
- Despliegue y configuración de cuentas o computadoras de empleados.

## Implementation Tasks

1. Radiant: contrato v2, receptor de servicio acotado, contexto, desgloses y panel.
2. Computers: configuración explícita, política y reenvío autenticado por máquina.
3. Host: captura, emisor central durable, compatibilidad directa y E2E.
4. Terminus: plan, revisión, evidencia y entrega revisable de los cuatro repos.

Orden: contrato → receptores → emisor → panel/verificación. Implementado por el
mismo agente sin delegación. Sin cambios funcionales al cliente Terminus: el
consumo vive en el motor y la supervisión empresarial vive en Radiant.

## Decision ledger

R1: v2 directo; fallback exclusivamente 404/405, conserva claves. Resuelto.
R2: atribución al ejecutar, ID IA opaco y sin contenido privado. Resuelto.
R3: cobertura explícita; no presentar duración como factura. Resuelto.
R4: conservar datos v1, idempotencia, retención y autorización. Resuelto.
R5: vía central Computers; Radiant fuera de la web. Resuelto.
R6: activación temporal explícita; no publicar colas anteriores. Resuelto.
Approval readiness: PASS — R1–R6 autorizadas por delegación del turno.

## Validación y entrega local

| Componente | Resultado |
|---|---|
| Radiant Python | 1212 pasan; 1 omitida porque requiere llavero macOS |
| Radiant frontend | 147 pasan; build, bundle y componentes upstream verificados |
| Radiant navegador | recorrido completo con CSP real; captura de Consumo |
| Radiant CLI | Rust tests y clippy pasan; ejemplos, paridad y paquete construidos |
| Computers | typecheck; 314 pruebas pasan en workerd; despliegue dry-run pasa |
| Host | build, fmt y clippy pasan con avisos heredados |
| Host general | 369 comprobaciones pasan, motor real con maestra temporal |
| Host conexión/cuentas | 245 comprobaciones pasan |
| Host vínculos/memoria | 32 comprobaciones pasan |
| Reporte directo/central | 12 + 7 comprobaciones pasan con motor y receptor reales |

Commits DCO locales: Radiant `74613e3`, Computers `663a50e`, seldon-host
`c5fd333`. Sus guías de configuración están en [integración empresarial de Radiant](https://github.com/danil-labs/Radiant/blob/main/docs/terminus-enterprise.md)
(Radiant) y [reporte de Computers](https://github.com/danil-labs/computers/blob/main/docs/radiant-usage.md) (Computers y host). Este repositorio solo
agrega el plan; no necesita recompilar clientes por un cambio documental.
Las pruebas usan identidades y CLI sintéticos; no hubo despliegue ni cambios
a proveedores reales. La captura del panel también usa datos sintéticos.

## Completion summary

Scope Challenge: entrega vertical reducida con límites declarados. Arquitectura:
3 hallazgos; calidad: 1; pruebas: 1 grupo; rendimiento sin hallazgos adicionales.
Los cinco hallazgos tienen remedios implementados y comprobados; se conservan
en el reporte para no presentar la revisión inicial como limpia.
Outside Voice: unavailable — host Codex sin proveedor externo compatible ni
fallback Plan/TaskStop. No acredita segunda opinión. La implementación no está
desplegada; el piloto con autoridades reales sigue sin verificar.
Paralelización: herramientas independientes, un implementador. Lake Score: N/A.

REALITY: premise-table pass evidencias y limites con unverified=1 apps/desktop/docs/radiant-enterprise-plan.md:49
REALITY: already-done pass fuentes existentes inspeccionadas y reutilizadas apps/desktop/docs/radiant-enterprise-plan.md:40
REALITY: surface-check pass motor Computers receptor y panel implementados apps/desktop/docs/radiant-enterprise-plan.md:95
REALITY: binding-decisions pass delegacion y frontera web conservadas apps/desktop/docs/radiant-enterprise-plan.md:29
REALITY: numbers pass limites de contrato y cuatro repositorios apps/desktop/docs/radiant-enterprise-plan.md:121
REALITY: deferred-asks pass exclusiones y piloto real sin verificar apps/desktop/docs/radiant-enterprise-plan.md:130
REALITY: pr-count pass cuatro commits locales sin PR apps/desktop/docs/radiant-enterprise-plan.md:60

## GSTACK REVIEW REPORT

| Review | Trigger | Why | Runs | Status | Findings |
|---|---|---|---|---|---|
| CEO Review | no ejecutado | Alcance | 0 | unavailable | No solicitado |
| Outside Review | host Codex | Segunda opinión | 0 | unavailable | Sin proveedor compatible |
| Eng Review | `/plan-eng-review` | Arquitectura y pruebas | 2 | ISSUES OPEN | 5 hallazgos históricos, remedios implementados; 0 sin resolver |
| Design Review | no ejecutado | UI | 0 | unavailable | Sistema existente conservado |
| DX Review | no ejecutado | Herramientas | 0 | unavailable | Sin CLI nueva |

**OUTSIDE COVERAGE:** unavailable, plan-review; no acredita segunda opinión.
**VERDICT:** implementación local revisada; remedios aceptados por delegación.
La configuración y operación del piloto de producción no están verificadas.
NO UNRESOLVED DECISIONS
