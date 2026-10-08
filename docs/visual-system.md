# Sistema visual

Los controles de Terminus usan tokens de `src/styles/global.css` y átomos de
`src/ui/`. Los valores por paleta están en [`color-tokens.md`](./color-tokens.md).

## Tema y paletas

La persona elige Sistema, Claro u Oscuro en Configuración → Apariencia. Puede
seleccionar Violeta o Grafito para claro, y Grafito o Azul para oscuro.
La configuración vive en `localStorage`; `src/lib/theme.ts` la aplica antes del
montaje mediante `data-theme`, `data-light-style` y `data-dark-style`.

El modo Sistema sigue `prefers-color-scheme`. Una elección explícita conserva su
modo aunque el sistema cambie. Las paletas se aplican por cascada CSS; un componente
no redefine sus valores.

## Color

| Uso | Regla |
|---|---|
| Superficies y texto | Tokens de la paleta, incluidos en `@theme static` |
| Acción | `primary` para acciones, enlaces y foco |
| Selección | Forma y estado del control; no confundirla con una acción nueva |
| Estado | Tokens semánticos para éxito, error, advertencia e información |
| Texto de estado | Variantes `strong` sobre la superficie o chip correspondiente |
| Diff | Fondos de adición y retirada, más el tramo de palabra cambiado |
| Identidad del agente | Cuerpo celeste o avatar y nombre; no es un estado de ejecución |
| Iconos de archivo | Identidad del formato, generada desde el paquete de iconos |

Los tonos del diff pertenecen a la paleta de la app. El color indica el lado del
cambio; las barras y símbolos conservan la distinción sin depender solo del color.
Los colores crudos de un componente requieren revisión manual: los guardas de
utilities y tema no detectan todos los valores CSS válidos.

## Tipografía y controles

Geist es la fuente de interfaz; Geist Mono, la de código; Bricolage Grotesque, la de
títulos. Las fuentes están empaquetadas y sus licencias están en `CREDITS.md`.

Los tamaños, radios, sombras y separación salen de tokens y variantes de átomos.
Los controles asumen el preflight de Tailwind. `cva` define variantes; `cn` combina
clases. Kobalte aporta foco, portal y accesibilidad de popovers, tooltips y menús.

Los nombres, `aria-label`, ayudas de error y estados vacíos salen del catálogo de
idioma. Un control deshabilitado conserva su identidad visual y semántica. El foco
se indica mediante las variantes del átomo; no se sustituye por un hover.

## Geometría de la ventana

`src/lib/window.ts` define la altura de cabecera y la reserva del semáforo de macOS.
La fila de título usa esas medidas; el riel y el panel de trabajo empiezan debajo.
Windows usa controles de ventana propios y Linux conserva decoración nativa.
La apariencia final requiere comprobarse en cada plataforma.

Las columnas laterales tienen ancho independiente. La conversación ocupa el espacio
restante. El reparto de paneles se guarda por espacio; con ancho insuficiente solo
se muestra el panel activo. Los menús y diálogos suspenden la capa nativa de sitios
para mantenerse visibles por encima de ella.

## Tema de terminal

`src/lib/terminal-themes.ts` y `src/styles/terminal.css` conservan los temas Terminus,
Tomorrow Night Blue, Nord, Gruvbox Dark y Dracula. `Workspace.terminal_theme` guarda
la elección y `data-terminal-theme` aplica los tokens `terminal-*`.

El selector de terminal no se ofrece en la sección Apariencia actual. Sus tokens
no repintan las superficies de la app; tampoco reemplazan los tonos actuales del
editor y el diff. La presencia del catálogo no certifica que todos los lectores de
código respondan a esa elección.

## Verificación

| Comprobación | Alcance |
|---|---|
| `scripts/terminal-themes.mjs` | Conjunto de tokens, coincidencia de catálogos y contraste calculado de temas de terminal |
| `scripts/missing-classes.mjs` | Utilities usadas que Tailwind no genera |
| `scripts/theme-inversion.mjs` | Colores de la paleta de Tailwind ajenos a los tokens del sistema |
| `scripts/icons.mjs` | Iconos generados frente al paquete fuente |
| `scripts/animations.mjs` | Animaciones continuas fuera del contrato permitido |

Los contrastes se calculan desde los tokens vigentes. Un valor histórico no certifica
las cuatro paletas actuales. Ninguno de esos guardas demuestra la accesibilidad
completa ni la apariencia de cada pantalla en una ventana nativa. El QA funcional
conserva plataforma, commit y sello del build probado.
