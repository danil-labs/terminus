# GSAP y Motion en Solid

Las skills oficiales de GSAP (`greensock/gsap-skills`) cubren React, Vue y
Svelte, pero no Solid. Esta página es la traducción para nuestro stack. Para la
API de GSAP en sí (easings, plugins, ScrollTrigger), las oficiales mandan.

## Lo que cambia en Solid

- **Un componente corre una sola vez.** No hay re-render: lo que se anima se
  crea en `onMount` y se deshace en `onCleanup`. Un `createEffect` solo hace
  falta cuando la animación depende de una señal, y entonces se revierte la
  anterior antes de crear la nueva.
- **El `ref` es una variable**, no un objeto con `.current`:
  `let caja!: HTMLDivElement` y `<div ref={caja}>`. Existe en `onMount`, no antes.
- **`<Show>` y `<For>` desmontan de inmediato.** Una salida animada no llega a
  verse si solo la dispara el desmontaje. Hace falta algo que retenga el nodo:
  el `Presence` de `solid-motionone`, o animar primero y cambiar la señal en el
  `finished` de la animación.
- **No se desestructuran las props**: se pierde la reactividad. Si la animación
  lee una prop, la lee dentro del efecto (`props.abierto`), o usa `splitProps`.

## GSAP

```tsx
import gsap from "gsap";
import { onCleanup, onMount } from "solid-js";

export function Bienvenida() {
  let raiz!: HTMLDivElement;
  onMount(() => {
    const mm = gsap.matchMedia();
    mm.add("(prefers-reduced-motion: no-preference)", () => {
      gsap.timeline()
        .from("[data-paso]", { y: 12, opacity: 0, stagger: 0.06, duration: 0.2 });
    }, raiz);
    onCleanup(() => mm.revert());
  });
  return <div ref={raiz}>…</div>;
}
```

- `gsap.matchMedia()` hace de `gsap.context()` y además atiende el movimiento
  reducido. El tercer argumento acota los selectores a `raiz`: sin él,
  `"[data-paso]"` busca en todo el documento y anima lo de otra vista.
- `revert()` quita también los estilos en línea que GSAP puso. `kill()` los deja.
- Los plugins (SplitText, Flip, MorphSVG…) vienen en el mismo paquete `gsap`
  desde la 3.13 y se registran una sola vez con `gsap.registerPlugin`, fuera del
  componente.

## Motion

```tsx
import { animate } from "motion";
import { onCleanup, onMount } from "solid-js";

onMount(() => {
  if (matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  const control = animate(caja, { opacity: [0, 1], y: [8, 0] }, { duration: 0.2 });
  onCleanup(() => control.stop());
});
```

- `animate()` de `motion` es la API sin framework y funciona tal cual en Solid.
  Usa Web Animations cuando puede, y por eso es más ligero que GSAP para
  entradas y salidas sueltas.
- Para salidas de algo que `<Show>` desmonta: `solid-motionone`
  (`<Presence>` + `<Motion>`). Es de la comunidad, no de Motion, así que antes
  de adoptarlo se revisa su fecha de publicación.

## El webview

- WebView2 (Windows), WKWebView (macOS) y WebKitGTK (Linux) no tienen el mismo
  soporte. `document.startViewTransition` no existe en WKWebView antes de macOS
  15, así que se comprueba siempre: `if (!document.startViewTransition) { cambiar(); return; }`.
- La app corre sin red: GSAP y Motion se instalan como dependencia, nunca se
  cargan desde un CDN.
