import { readFileSync, readdirSync } from "node:fs";
import { join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig, type Plugin } from "vite";
import solid from "vite-plugin-solid";
import tailwindcss from "@tailwindcss/vite";

const fonts = resolve(fileURLToPath(
  new URL("./node_modules/@excalidraw/excalidraw/dist/prod/fonts/", import.meta.url),
));

function fontFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    return entry.isDirectory() ? fontFiles(path) : [path];
  });
}

function excalidrawFonts(): Plugin {
  return {
    name: "excalidraw-fonts",
    configureServer(server) {
      server.middlewares.use("/excalidraw/fonts", (req, res, next) => {
        const name = decodeURIComponent(new URL(req.url ?? "/", "http://localhost").pathname).slice(1);
        const path = resolve(fonts, name);
        if (!path.startsWith(fonts + sep) || !path.endsWith(".woff2")) return next();
        try {
          res.setHeader("content-type", "font/woff2");
          res.end(readFileSync(path));
        } catch {
          next();
        }
      });
    },
    generateBundle() {
      for (const path of fontFiles(fonts)) {
        this.emitFile({
          type: "asset",
          fileName: `excalidraw/fonts/${relative(fonts, path).split(sep).join("/")}`,
          source: readFileSync(path),
        });
      }
    },
  };
}

// Tauri espera un puerto fijo y falla si no está disponible. `strictPort` se
// conserva a propósito: con varias ramas probándose a la vez, un puerto que se
// mueve solo haría que la ventana cargue la app de OTRA rama sin decir nada.
// Mejor que truene. Quién asigna el puerto de cada rama: `scripts/dev.mjs`.
export default defineConfig({
  // Tailwind v4 es CSS-first: no hay `tailwind.config.js`, los tokens viven en
  // el `@theme` de `src/styles/global.css` y este plugin es todo el cableado.
  plugins: [solid(), tailwindcss(), excalidrawFonts()],
  clearScreen: false,
  // **Sin esto la ventana sale en blanco en desarrollo, y sin un solo error.**
  //
  // `micromark` —que `solid-markdown` arrastra— publica dos builds por
  // condición de exportación:
  //
  //     ".": { "development": "./dev/index.js", "default": "./index.js" }
  //
  // y **solo el de desarrollo importa `debug`**, que es CommonJS. Vite resuelve
  // con la condición `development`, sirve ese archivo crudo, y el navegador
  // muere al evaluarlo:
  //
  //     SyntaxError: The requested module '…/debug/src/browser.js'
  //     does not provide an export named 'default'
  //
  // Eso revienta la evaluación del grafo **entero**: `main.tsx` no llega a
  // correr, `#root` se queda con cero hijos y la consola no dice nada. Se ve
  // idéntico a una app que no arrancó. Salió importando `main.tsx` a mano desde
  // la propia página, que es lo único que hace hablar al error.
  //
  // `optimizeDeps.include` no sirve aquí: con el layout de pnpm ni `micromark`
  // ni `debug` son dependencias directas, y Vite contesta *«Failed to resolve
  // dependency»*. Lo que sí decide es la condición, y se pide `production` a
  // propósito — de micromark no queremos su build de desarrollo, que es
  // justamente el que trae la dependencia rota.
  //
  // Por qué `pnpm build` pasaba y `pnpm desktop:dev` no: en producción se usa
  // la condición `default`, que no importa `debug`.
  optimizeDeps: {
    include: [
      // Llega por `micromark`, y por eso `debug` está declarado en
      // `devDependencies` aunque nadie lo importe: con el layout de pnpm no es
      // alcanzable desde la raíz, y sin declararlo Vite contesta *«Failed to
      // resolve dependency»* y no lo pre-empaqueta.
      "debug",
      // Estos sí se alcanzan atravesando a su padre. `style-to-js` NO se pone:
      // no resuelve por esta vía y tampoco hace falta.
      "solid-markdown > extend",
      "solid-markdown > style-to-object",
      "solid-markdown > inline-style-parser",
    ],
  },
  server: {
    port: Number(process.env.HARNESS_DEV_PORT) || 5174,
    strictPort: true,
    watch: {
      ignored: ["**/src-tauri/**"],
    },
  },
});
