import { createSignal, For, lazy, Match, onMount, Show, Suspense, Switch } from "solid-js";
import Check from "lucide-solid/icons/check";
import { crearWorkspace } from "../features/onboarding/onboarding-store";
import { Opcion, Pantalla } from "../features/onboarding/Screen";
import { invoke } from "../lib/invoke.ts";
import { t } from "../lib/i18n";
import { capabilities } from "../lib/platform";
import { cn } from "../lib/utils";
import { HEADER_HEIGHT } from "../lib/window";
import { Input } from "../ui/Input";
import { OnboardingAccounts } from "./OnboardingAccounts";
import "./phrases";

/**
 * The first run on a managed computer: it is prepared and its cloud agents are
 * installed at provisioning, so the person only creates a space and connects
 * accounts. The desktop flow stays in `features/onboarding/Onboarding.tsx`.
 */

const Radiant = lazy(() => import("../features/settings/Radiant"));

type Step = "space" | "accounts";
type Machine = { id: string; active: boolean };

export default function WebOnboarding(props: { nuevo?: boolean; onListo: () => void; onCancelar?: () => void }) {
  const [step, setStep] = createSignal<Step>("space");
  const [workspace, setWorkspace] = createSignal<string | null>(null);
  const [machine, setMachine] = createSignal<string | null>(null);

  // Which computer only matters when there is more than one.
  onMount(() => {
    invoke<Machine[]>("machine_list")
      .then((list) => {
        const here = list.find((m) => m.active);
        if (list.length > 1 && here) setMachine(capabilities().machineName?.(here.id) ?? here.id);
      })
      .catch(() => {});
  });

  return (
    <div class="flex min-h-0 flex-1 flex-col overflow-hidden bg-bg" data-web-onboarding={step()}>
      <header class={cn("flex shrink-0 items-center gap-5 border-b border-border px-7 text-xs", HEADER_HEIGHT)}>
        <Steps current={step() === "space" ? 0 : 1} />
        <span class="flex-1" />
        <Show when={machine()}>
          {(name) => <span class="text-neutral-500" data-web-onboarding-machine="">{t("web.onboarding.machine", { name: name() })}</span>}
        </Show>
      </header>
      <Switch>
        <Match when={step() === "space"}>
          <Space
            nuevo={Boolean(props.nuevo)}
            onCancelar={props.onCancelar}
            onCreated={(name) => {
              setWorkspace(name);
              setStep("accounts");
            }}
          />
        </Match>
        <Match when={step() === "accounts"}>
          <OnboardingAccounts workspace={workspace() ?? ""} onDone={props.onListo} />
        </Match>
      </Switch>
    </div>
  );
}

function Steps(props: { current: number }) {
  const steps = () => [t("web.onboarding.steps.space"), t("web.onboarding.steps.accounts")];
  return (
    <nav class="flex gap-5" aria-label={t("onboarding.phases.label")}>
      <For each={steps()}>
        {(label, i) => (
          <span
            class={cn("flex items-center gap-1", i() === props.current ? "font-semibold text-primary" : "text-neutral-500")}
            aria-current={i() === props.current ? "step" : undefined}
          >
            <Show when={i() < props.current} fallback={i() + 1}>
              <Check size={12} aria-hidden="true" />
            </Show>{" "}
            {label}
          </span>
        )}
      </For>
    </nav>
  );
}

/** A personal workspace, or one tied to the organization through Radiant once it exists. */
function Space(props: { nuevo: boolean; onCancelar?: () => void; onCreated: (name: string) => void }) {
  const [kind, setKind] = createSignal<"personal" | "organization">("personal");
  const [name, setName] = createSignal(props.nuevo ? "" : t("onboarding.manual.default_name"));
  const [created, setCreated] = createSignal<string | null>(null);
  const [busy, setBusy] = createSignal(false);
  const [error, setError] = createSignal<unknown>(null);

  async function create() {
    const wanted = name().trim();
    if (!wanted || busy()) return;
    setBusy(true);
    setError(null);
    try {
      await crearWorkspace(wanted);
      setCreated(wanted);
      if (kind() === "personal") props.onCreated(wanted);
    } catch (e) {
      setError(e);
    } finally {
      setBusy(false);
    }
  }

  const primary = () => {
    const done = created();
    if (done) return { rotulo: t("onboarding.continue"), onClick: () => props.onCreated(done) };
    return {
      rotulo: busy() ? t("onboarding.workspace.creating") : t("onboarding.workspace.create"),
      onClick: () => void create(),
      disabled: !name().trim() || busy(),
    };
  };

  return (
    <Pantalla
      titulo={t("web.onboarding.space.title")}
      lede={t("web.onboarding.space.lede")}
      pie={t("onboarding.workspace.footer")}
      atras={props.nuevo && !created() ? props.onCancelar : undefined}
      atrasRotulo={t("onboarding.cancel")}
      primario={primary()}
      error={error()}
    >
      <Show
        when={!created()}
        fallback={
          <Suspense>
            <Radiant />
          </Suspense>
        }
      >
        <form
          class="grid gap-6"
          onSubmit={(ev) => {
            ev.preventDefault();
            void create();
          }}
        >
          <div class="flex flex-wrap gap-2" role="group">
            <Opcion activa={kind() === "personal"} onClick={() => setKind("personal")}>
              {t("web.onboarding.space.personal")}
            </Opcion>
            <Opcion activa={kind() === "organization"} onClick={() => setKind("organization")}>
              {t("web.onboarding.space.organization")}
            </Opcion>
          </div>
          <label class="grid gap-1.5">
            <span class="text-[0.8125rem] font-semibold">{t("onboarding.workspace.name")}</span>
            <Input value={name()} onInput={(ev) => setName(ev.currentTarget.value)} />
          </label>
          <Show when={kind() === "organization"}>
            <p class="m-0 text-sm text-neutral-500">{t("web.onboarding.space.organization_hint")}</p>
          </Show>
        </form>
      </Show>
    </Pantalla>
  );
}
