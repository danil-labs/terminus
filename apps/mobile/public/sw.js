/*
 * Avisos del teléfono: solo `push` y `notificationclick`, sin `fetch` ni caché,
 * así que nunca toca la red de la app. Vive en `<base>m/` con ese scope: en
 * app.danil.ai la raíz es del service worker de Appv2.
 *
 * El aviso nunca trae una dirección: se arma aquí con sus identificadores, y
 * `sign_in` solo lleva a la entrada de este mismo origen, que escribe el build
 * (`web-mobile.mjs`) porque cambia con la base y con WorkOS.
 */

const SIGN_IN = "__TERMINUS_SIGN_IN__";

const WORDS = {
  es: { finished: "Tu tarea terminó", failed: "Tu tarea se detuvo", approving: "Tu tarea pide aprobación", asked: "Tu tarea te preguntó algo", sign_in: "Inicia sesión en Danil", body: "Toca para abrirla.", sign_in_body: "Toca para abrir la pantalla de inicio de sesión." },
  en: { finished: "Your task finished", failed: "Your task stopped", approving: "Your task needs approval", asked: "Your task asked you something", sign_in: "Sign in to Danil", body: "Tap to open it.", sign_in_body: "Tap to open the sign-in screen." },
};
const KINDS = ["finished", "failed", "approving", "asked", "sign_in"];
const ID = /^[A-Za-z0-9._:-]{1,128}$/;

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

function targetOf(notice) {
  const scope = new URL(self.registration.scope);
  if (notice.kind === "sign_in") return SIGN_IN.startsWith("/") ? new URL(SIGN_IN, scope).href : scope.href;
  const { computer, workspace, folder, session } = notice;
  if (![computer, workspace, session].every((id) => ID.test(id ?? "")) || !(folder == null || ID.test(folder))) return scope.href;
  const path = [computer, workspace, folder || "_", session].map(encodeURIComponent).join("/");
  scope.searchParams.set("to", `/task/${path}`);
  return scope.href;
}

self.addEventListener("push", (event) => {
  let notice = {};
  try {
    notice = event.data ? event.data.json() : {};
  } catch {
    notice = {};
  }
  const words = (self.navigator.language || "").toLowerCase().startsWith("es") ? WORDS.es : WORDS.en;
  const kind = KINDS.includes(notice.kind) ? notice.kind : "finished";
  const signIn = kind === "sign_in";
  // Safari retira la suscripción tras varios avisos que no se muestran: siempre se muestra.
  event.waitUntil(self.registration.showNotification(words[kind], {
    body: signIn ? words.sign_in_body : words.body,
    icon: new URL("icons/icon-192.png", self.registration.scope).href,
    tag: signIn ? "sign-in" : `task:${notice.computer}:${notice.session}`,
    renotify: true,
    data: { url: targetOf(notice) },
  }));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const url = event.notification.data?.url;
  if (!url || new URL(url).origin !== self.location.origin) return;
  event.waitUntil((async () => {
    const open = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const window = open.find((client) => "navigate" in client);
    // `navigate` falla en una ventana que este worker no controla: entonces se abre otra.
    const moved = window ? await window.focus().then(() => window.navigate(url)).catch(() => null) : null;
    if (!moved) await self.clients.openWindow(url);
  })());
});
