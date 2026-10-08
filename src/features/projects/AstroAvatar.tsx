import { type JSX, Show, createEffect, createSignal, onCleanup } from "solid-js";
import type { HandlerStatus } from "../../lib/model";
import { cn } from "../../lib/utils";
import { generacionDeAvatar, urlDeAvatar } from "./avatar-src";

/**
 * Los cuerpos que puede tener un agente (`docs/agents.md` § Interfaz).
 *
 * **Solo se añade al final.** El orden fija el índice de [`cuerpoDe`]:
 * reordenar o insertar le cambia la cara a todos los agentes ya declarados.
 *
 * El catálogo crece para que menos agentes compartan cara.
 */
export const CUERPOS = [
  "sun",
  "planet",
  "moon",
  "asteroid",
  "star",
  "hole",
  "ringed",
  "comet",
  "nebula",
  "binary",
  "dwarf",
  "pulsar",
  "catplanet",
  "monkeyplanet",
] as const;
export type Cuerpo = (typeof CUERPOS)[number];

/** Si una cara guardada sigue existiendo en el catálogo. */
export const isBody = (v: string | null | undefined): v is Cuerpo =>
  !!v && (CUERPOS as readonly string[]).includes(v);

/**
 * El mismo nombre da siempre el mismo cuerpo, sin guardar nada: ningún agente
 * nace sin cara (`docs/agents.md` § Interfaz).
 */
function cuerpoDe(name: string): Cuerpo {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  return CUERPOS[Math.abs(h) % CUERPOS.length];
}

/** La clase que lleva los dos tonos del cuerpo. Literal para que se encuentre
 * desde `global.css` con `grep`: compuesta con plantilla, no la ve nadie. */
const CLASE: Record<Cuerpo, string> = {
  sun: "astro-sun",
  planet: "astro-planet",
  moon: "astro-moon",
  asteroid: "astro-asteroid",
  star: "astro-star",
  hole: "astro-hole",
  ringed: "astro-ringed",
  comet: "astro-comet",
  nebula: "astro-nebula",
  binary: "astro-binary",
  dwarf: "astro-dwarf",
  pulsar: "astro-pulsar",
  catplanet: "astro-catplanet",
  monkeyplanet: "astro-monkeyplanet",
};

/**
 * Los ángulos de entrada de la materia que cae al agujero negro, con su retraso
 * en doceavos de segundo, el paso del reloj común (`global.css`).
 * Repartidos sin regla para que el disco no lata a compás.
 */
const CAIDAS: [number, number][] = [
  [0, 0],
  [58, 4],
  [124, 8],
  [190, 2],
  [246, 6],
  [308, 10],
];

/**
 * Ancla cada animación de un astro al origen del documento. Sin esto cada una
 * cuenta sus pasos desde que montó y N avatares repintan a 12·N cuadros por
 * segundo en vez de 12.
 */
function alignToSharedClock(event: AnimationEvent) {
  const face = (event.target as Element | null)?.closest?.(".astro-face");
  if (!face) return;
  for (const animation of face.getAnimations({ subtree: true })) {
    if ("animationName" in animation && animation.startTime !== 0) animation.startTime = 0;
  }
}

/** Escondida o sin foco, la ventana apaga los astros (`global.css`). */
function markWindowIdle() {
  const idle = document.visibilityState !== "visible" || !document.hasFocus();
  document.documentElement.toggleAttribute("data-window-idle", idle);
}

if (typeof document !== "undefined") {
  document.addEventListener("animationstart", alignToSharedClock, true);
  document.addEventListener("visibilitychange", markWindowIdle);
  window.addEventListener("focus", markWindowIdle);
  // Al pasar el foco a un iframe del visor la ventana recibe `blur` sin perderlo.
  window.addEventListener("blur", () => setTimeout(markWindowIdle));
  markWindowIdle();
}

/**
 * El trazo de cada cuerpo, en los dos tonos que su clase pone en `--astro-1` y
 * `--astro-2` (`global.css`). Lo que va dentro de `astro-gira` es superficie:
 * sin manchas, una esfera girando se ve quieta.
 */
function trazosDe(cuerpo: Cuerpo): JSX.Element {
  switch (cuerpo) {
    case "sun":
      return (
        <>
          <g class="astro-gira">
            <circle cx="32" cy="32" r="20" fill="var(--astro-2)" />
            <circle cx="32" cy="32" r="20" fill="var(--astro-1)" opacity="0.5" />
            <g fill="var(--astro-2)" opacity="0.45">
              <ellipse cx="20" cy="24" rx="6" ry="3" />
              <ellipse cx="44" cy="41" rx="5" ry="2.6" />
            </g>
          </g>
          <g class="astro-corona" stroke="var(--astro-2)" stroke-width="3.4" stroke-linecap="round">
            <path d="M32 1v7M32 56v7M1 32h7M56 32h7M9.5 9.5l5 5M49.5 49.5l5 5M54.5 9.5l-5 5M14.5 49.5l-5 5" />
          </g>
        </>
      );
    case "planet":
      return (
        <>
          <g class="astro-gira">
            <circle cx="32" cy="32" r="19.5" fill="var(--astro-2)" />
            <path d="M12.5 27a19.5 19.5 0 0 1 39 0z" fill="var(--astro-1)" opacity="0.55" />
            <g fill="var(--astro-1)" opacity="0.34">
              <ellipse cx="22" cy="40" rx="7" ry="3" />
              <ellipse cx="43" cy="43" rx="5" ry="2.3" />
            </g>
          </g>
          <ellipse
            class="astro-columpio"
            cx="32"
            cy="34"
            rx="30"
            ry="8.5"
            fill="none"
            stroke="var(--astro-2)"
            stroke-width="3.2"
          />
        </>
      );
    case "moon":
      return (
        <g class="astro-gira">
          <circle cx="32" cy="32" r="21" fill="var(--astro-2)" />
          <circle cx="32" cy="32" r="21" fill="var(--astro-1)" opacity="0.55" />
          <g fill="var(--astro-2)" opacity="0.8">
            <circle cx="47" cy="22" r="3.6" />
            <circle cx="17" cy="44" r="2.8" />
            <circle cx="45" cy="45" r="2.2" />
            <circle cx="21" cy="20" r="1.8" />
          </g>
        </g>
      );
    case "asteroid":
      return (
        <g class="astro-gira">
          <path d="M32 6 52 14l7 18-9 18-19 8-17-11-4-20 10-16z" fill="var(--astro-2)" />
          <path d="M32 6 52 14l3 9-23 2-14-6z" fill="var(--astro-1)" opacity="0.6" />
          <g fill="var(--astro-1)" opacity="0.3">
            <circle cx="24" cy="44" r="4" />
            <circle cx="44" cy="38" r="2.6" />
          </g>
        </g>
      );
    case "star":
      return (
        <g class="astro-gira">
          <path
            d="M32 1l7.8 21.8L63 27.2 45.5 42.6l5.4 20.6L32 51.4 13.1 63.2l5.4-20.6L1 27.2l23.2-4.4z"
            fill="var(--astro-2)"
          />
          <path d="M32 1l7.8 21.8L63 27.2 32 27.2z" fill="var(--astro-1)" opacity="0.6" />
        </g>
      );
    case "hole":
      return (
        <>
          <ellipse cx="32" cy="32" rx="30" ry="9" fill="none" stroke="var(--astro-1)" stroke-width="7" opacity="0.32" />
          {CAIDAS.map(([ang, retraso]) => (
            <g class="astro-caida" style={{ "--astro-ang": `${ang}deg` }}>
              <circle
                class="astro-particula"
                cx="7"
                cy="32"
                r="1.7"
                fill="var(--astro-1)"
                style={{ "animation-delay": `${retraso / 12}s` }}
              />
            </g>
          ))}
          <circle cx="32" cy="32" r="16" fill="var(--astro-2)" />
          <circle class="astro-fotones" cx="32" cy="32" r="16" fill="none" stroke="var(--astro-1)" stroke-width="2.6" />
          <path
            d="M2 32a30 9 0 0 0 60 0"
            fill="none"
            stroke="var(--astro-1)"
            stroke-width="6"
            stroke-linecap="round"
            opacity="0.8"
          />
        </>
      );
    case "ringed":
      return (
        <>
          <g class="astro-gira">
            <circle cx="32" cy="32" r="18" fill="var(--astro-2)" />
            <path d="M14 28a18 18 0 0 1 36 0z" fill="var(--astro-1)" opacity="0.5" />
          </g>
          <g class="astro-columpio">
            <ellipse cx="32" cy="34" rx="31" ry="7.5" fill="none" stroke="var(--astro-2)" stroke-width="3.4" />
            <ellipse cx="32" cy="34" rx="25" ry="5.5" fill="none" stroke="var(--astro-1)" stroke-width="1.8" />
          </g>
        </>
      );
    case "comet":
      return (
        <>
          <g class="astro-estela" stroke="var(--astro-1)" stroke-linecap="round" fill="none">
            <path d="M8 52q14 -10 24 -22" stroke-width="5" opacity="0.5" />
            <path d="M16 58q12 -8 19 -19" stroke-width="3" opacity="0.32" />
          </g>
          <g class="astro-gira">
            <circle cx="40" cy="25" r="16" fill="var(--astro-2)" />
            <path d="M24 25a16 16 0 0 1 32 0z" fill="var(--astro-1)" opacity="0.5" />
          </g>
        </>
      );
    case "nebula":
      return (
        <>
          <g class="astro-columpio" opacity="0.5" fill="none" stroke="var(--astro-1)">
            <ellipse cx="32" cy="32" rx="30" ry="17" stroke-width="4" />
            <ellipse cx="32" cy="32" rx="17" ry="30" stroke-width="2.4" />
          </g>
          <g class="astro-gira">
            <circle cx="32" cy="32" r="17" fill="var(--astro-2)" />
            <path d="M15 32a17 17 0 0 1 34 0z" fill="var(--astro-1)" opacity="0.55" />
          </g>
        </>
      );
    case "binary":
      return (
        <>
          <g class="astro-gira">
            <circle cx="23" cy="36" r="16" fill="var(--astro-2)" />
            <path d="M7 36a16 16 0 0 1 32 0z" fill="var(--astro-1)" opacity="0.5" />
            <circle cx="47" cy="20" r="9" fill="var(--astro-1)" />
          </g>
        </>
      );
    case "dwarf":
      return (
        <g class="astro-gira">
          <circle cx="32" cy="32" r="16" fill="var(--astro-2)" />
          <path d="M16 32a16 16 0 0 1 32 0z" fill="var(--astro-1)" opacity="0.55" />
          <g fill="var(--astro-1)" opacity="0.4">
            <circle cx="24" cy="41" r="3.4" />
            <circle cx="41" cy="27" r="2.2" />
          </g>
        </g>
      );
    case "pulsar":
      return (
        <>
          <g class="astro-columpio" fill="var(--astro-1)" opacity="0.6">
            <path d="M32 0l4.5 22h-9z" />
            <path d="M32 64l-4.5 -22h9z" />
          </g>
          <g class="astro-gira">
            <circle cx="32" cy="32" r="16" fill="var(--astro-2)" />
            <path d="M16 32a16 16 0 0 1 32 0z" fill="var(--astro-1)" opacity="0.5" />
          </g>
          <circle class="astro-fotones" cx="32" cy="32" r="16" fill="none" stroke="var(--astro-1)" stroke-width="2.2" />
        </>
      );
    case "catplanet":
      return (
        <>
          <path
            d="M47 40c11 4 13 16 5 21"
            fill="none"
            stroke="var(--astro-2)"
            stroke-width="4.2"
            stroke-linecap="round"
          />
          <g class="astro-gira">
            <circle cx="32" cy="32" r="17.5" fill="var(--astro-2)" />
            <path d="M14.5 32a17.5 17.5 0 0 1 35 0z" fill="var(--astro-1)" opacity="0.55" />
          </g>
          <g fill="var(--astro-2)">
            <path d="M12 25 18 5l10 18z" />
            <path d="m16 22 3-11 6 10z" fill="var(--astro-1)" opacity="0.8" />
          </g>
          <g fill="var(--astro-2)">
            <path d="M52 25 46 5 36 23z" />
            <path d="m48 22-3-11-6 10z" fill="var(--astro-1)" opacity="0.8" />
          </g>
          <g
            class="astro-bigotes"
            fill="none"
            stroke="var(--astro-ojo)"
            stroke-width="1.5"
            stroke-linecap="round"
            opacity="0.55"
            style={{ "transform-origin": "32px 38px" }}
          >
            <path d="M10 35h9M10 40h8" />
            <path d="M45 35h9M46 40h8" />
          </g>
        </>
      );
    case "monkeyplanet":
      return (
        <>
          <g
            class="astro-cola"
            fill="none"
            stroke="var(--astro-2)"
            stroke-width="3.6"
            stroke-linecap="round"
            style={{ "transform-origin": "46px 42px" }}
          >
            <path d="M47 40c13 6 13 20-1 20-10 0-8-8 0-8 8 0 8 6 2 8" />
          </g>
          <g class="astro-gira">
            <circle cx="32" cy="32" r="17.5" fill="var(--astro-2)" />
            <path d="M14.5 32a17.5 17.5 0 0 1 35 0z" fill="var(--astro-1)" opacity="0.55" />
          </g>
          <g class="astro-orejas" fill="var(--astro-2)" style={{ "transform-origin": "12px 26px" }}>
            <circle cx="11" cy="26" r="7.2" />
            <circle cx="11" cy="26" r="4" fill="var(--astro-1)" opacity="0.7" />
          </g>
          <g
            class="astro-orejas astro-orejas-inv"
            fill="var(--astro-2)"
            style={{ "transform-origin": "52px 26px" }}
          >
            <circle cx="53" cy="26" r="7.2" />
            <circle cx="53" cy="26" r="4" fill="var(--astro-1)" opacity="0.7" />
          </g>
          <ellipse cx="32" cy="36" rx="9" ry="8" fill="var(--astro-1)" opacity="0.4" />
        </>
      );
  }
}

/**
 * La cara de un agente declarado: cuerpo determinista por nombre, ojos por
 * estado. Solo tres — «pensando» no existe, el backend no lo puede dar
 * (`docs/agents.md` § Interfaz). Los dos pares de ojos se pintan siempre y
 * `global.css` esconde el que no toca: alternarlos con `Show` remonta el nodo
 * y corta el parpadeo a media animación.
 */
export function AstroAvatar(props: {
  name: string;
  status: HandlerStatus;
  size?: number;
  class?: string;
  /** La cara elegida en su perfil. Sin ella manda el hash del nombre. */
  body?: string | null;
  /** Ruta de una imagen propia. Gana al cuerpo y no lleva sus trazos. */
  avatar?: string | null;
}) {
  const size = () => props.size ?? 34;
  const cuerpo = () => (isBody(props.body) ? props.body : cuerpoDe(props.name));
  const [url, setUrl] = createSignal<string | null | undefined>(undefined);
  createEffect(() => {
    const path = props.avatar;
    generacionDeAvatar();
    if (!path) {
      setUrl(undefined);
      return;
    }
    setUrl(undefined);
    let vivo = true;
    onCleanup(() => {
      vivo = false;
    });
    void urlDeAvatar(path).then((siguiente) => {
      if (vivo) setUrl(siguiente);
    });
  });
  return (
    <span
      class="astro-face relative inline-flex shrink-0"
      data-astro-working={props.status === "working" ? "true" : undefined}
    >
      <Show
        when={url()}
        fallback={
          <svg
            class={cn(
              "block shrink-0 overflow-visible",
              CLASE[cuerpo()],
              props.status === "asleep" && "opacity-[0.62]",
              props.class,
            )}
            width={size()}
            height={size()}
            viewBox="0 0 64 64"
            aria-hidden="true"
            data-astro-status={props.status}
          >
            {trazosDe(cuerpo())}
            <g class="astro-ojos" fill="var(--astro-ojo)">
              <ellipse cx="26" cy="34" rx="2.7" ry="3.5" />
              <ellipse cx="38" cy="34" rx="2.7" ry="3.5" />
            </g>
            <g
              class="astro-ojos-cerrados"
              fill="none"
              stroke="var(--astro-ojo)"
              stroke-width="2.7"
              stroke-linecap="round"
            >
              <path d="M21.5 34q4.5 4 9 0" />
              <path d="M33.5 34q4.5 4 9 0" />
            </g>
          </svg>
        }
      >
        {(src) => (
          <img
            src={src()}
            alt=""
            width={size()}
            height={size()}
            draggable={false}
            class={cn(
              "block shrink-0 rounded-full object-contain",
              props.status === "asleep" && "opacity-[0.62]",
              props.class,
            )}
          />
        )}
      </Show>
    </span>
  );
}
