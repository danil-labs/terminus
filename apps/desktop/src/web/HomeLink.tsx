import LayoutGrid from "lucide-solid/icons/layout-grid";
import { t } from "../lib/i18n";

/** Back to Danil Agents, served at the root of the same origin. */
export function HomeLink() {
  return (
    <a
      href="/"
      data-web-home=""
      class="ml-auto inline-flex size-7 shrink-0 items-center justify-center rounded-md text-neutral-500 hover:bg-neutral-200"
      aria-label={t("web.home")}
      title={t("web.home")}
    >
      <LayoutGrid size={16} />
    </a>
  );
}
