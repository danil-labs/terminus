# Plugins de Terminus

Los plugins aportan capacidades opcionales. La instalación de binarios es
compartida; su activación pertenece a cada workspace. La lengua seleccionada
también pertenece al workspace.

| Clase | Material y entrada | Instalación |
|---|---|---|
| Lenguas | JSON desde el bundle, una carpeta o un ZIP local | `<app data>/lenguas/<código>/` |
| Binarios | Artefactos de terceros descargados con versión y SHA-256 fijados | `<app data>/entorno/<id>/<versión>/` |

## Catálogo

| Id | Capacidad | Ficha |
|---|---|---|
| `yua` | Catálogo y perfil de salida en maya yucateco | [Lengua](lenguas/yua/README.md) |
| `agentsview` | Índice local de sesiones | AgentsView (motor) |
| `libreoffice` | Conversión de documentos | LibreOffice (motor) |
| `drawio` | Visor de diagramas en el chat | draw.io (motor) |
| `computer-use` | Pantalla y acciones de escritorio por MCP | Cua Driver (motor) |
| `typst` | Vista en vivo y exportación de documentos Typst en la vista del archivo | Typst (motor) |

## Lenguas

El paquete contiene `manifiesto.json` y catálogos JSON. El bundle ofrece los
paquetes de `plugins/lenguas/`; la persona también puede elegir una carpeta o
un ZIP. Ambas entradas las valida el motor.
No hay descarga de paquetes de lengua por red.

Instalar copia los JSON; los Markdown permanecen en el repositorio.
`remove_language_pack` retira el paquete instalado. `scripts/plugins.mjs`
valida manifiestos, claves, placeholders y ortografía del saltillo; reporta
cobertura sin exigir que el paquete traduzca todo el catálogo.

Los plugins binarios (descarga, hash, instalación y activación) los gestiona el
motor de Terminus; la ventana solo los muestra en Configuración → Plugins
(`src/features/settings/Plugins.tsx`).
