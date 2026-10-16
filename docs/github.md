# GitHub por workspace

Cada workspace conecta su cuenta y confirma qué organizaciones y repositorios
puede usar. La autorización de una GitHub App en GitHub y la selección local de
un workspace son decisiones distintas. Agregar acceso en GitHub no amplía por sí
solo la selección de otro workspace.

## Conectar

1. Abre Configuración → Control de Fuentes → GitHub y conecta la cuenta.
2. El selector oficial de GitHub permite instalar o configurar la App en una
   cuenta personal u organización, aunque existan instalaciones previas.
3. Al volver a Terminus, actualiza el acceso y confirma las áreas que usará
   este workspace. Agregar/configurar no repite el inicio de sesión.

Cancelar conserva la selección confirmada. Desconectar afecta solo al workspace
actual; no desinstala la App en GitHub. Una conexión anterior sin repositorios
confirmados necesita confirmar su selección antes del acceso gestionado.

## gh opcional

La conexión de GitHub no necesita `gh`. Configuración permite descargar una
versión compatible si un agente la necesita. El motor descarga el artefacto
oficial y comprueba su SHA-256; no depende de Homebrew ni winget. El agente
puede solicitarlo con `terminus github install` y consultar su disponibilidad
con `terminus github status`.

El `gh` gestionado consulta un intermediario local del motor. Recibe un permiso
de sesión del workspace y no la credencial externa de GitHub. El motor limita
las operaciones a los repositorios confirmados; las consultas y escrituras
admitidas se revalidan en cada llamada. Una operación desconocida se rechaza.
El proceso nativo del agente conserva su acceso al equipo: esto no es un sandbox.

## Ventana y motor

La ventana implementa selección, retorno del navegador e instalación a demanda.
La bóveda, los IDs de repositorio aprobados, el intermediario y el entorno de
agentes pertenecen al motor privado. `check_environment` comunica el inventario
opcional `githubCli`; `install_gh` es el comando existente. No se agrega un
comando ni se cambia el hash del contrato RPC1 congelado.

Esta interfaz necesita el portado correspondiente del motor. Para distribuir
la función completa se debe publicar ese motor y actualizar
`seldon-runtime.lock` con sus artefactos verificados. El lock anterior no
acredita aislamiento por workspace ni soporte del intermediario. Los PRs de
ventana y motor se revisan coordinadamente antes de una release.

`node tests/helpers/github-workspace-ui.mjs`, después de `pnpm build`, comprueba
los tres recorridos del selector sobre el frontend compilado con IPC simulado.
Es integración; no prueba el navegador nativo, login o permisos reales de GitHub.
