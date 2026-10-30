import { MOBILE_WEB_DIR, PHONE_QUERY, WEB_LAYOUT_KEY } from "@terminus/design";
import Smartphone from "lucide-solid/icons/smartphone";
import { Show } from "solid-js";
import { t } from "../lib/i18n";

/** On a phone, the link to the phone's Terminus. */
export function HomeLink() {
  return (
    <>

    <Show when={window.matchMedia(PHONE_QUERY).matches}>
      <a
        href={`${import.meta.env.BASE_URL}${MOBILE_WEB_DIR}/`}
        onClick={() => {
          try {
            localStorage.setItem(WEB_LAYOUT_KEY, "mobile");
          } catch {
            // Sin almacenamiento, el teléfono abre el suyo de todos modos.
          }
        }}
        class="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200"
        aria-label={t("web.phone_layout")}
        title={t("web.phone_layout")}
      >
        <Smartphone size={16} />
      </a>
    </Show>
    </>
  );
}
