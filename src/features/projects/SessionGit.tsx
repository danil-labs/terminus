import CircleCheck from "lucide-solid/icons/circle-check";
import CircleDashed from "lucide-solid/icons/circle-dashed";
import CircleX from "lucide-solid/icons/circle-x";
import FileIcon from "lucide-solid/icons/file";
import FileCheck from "lucide-solid/icons/file-check";
import FilePenLine from "lucide-solid/icons/file-pen-line";
import GitBranch from "lucide-solid/icons/git-branch";
import GitCommitHorizontal from "lucide-solid/icons/git-commit-horizontal";
import GitMerge from "lucide-solid/icons/git-merge";
import GitPullRequest from "lucide-solid/icons/git-pull-request";
import GitPullRequestClosed from "lucide-solid/icons/git-pull-request-closed";
import GitPullRequestDraft from "lucide-solid/icons/git-pull-request-draft";
import MessageSquareWarning from "lucide-solid/icons/message-square-warning";
import UserCheck from "lucide-solid/icons/user-check";
import { type JSX, Show } from "solid-js";
import { Dynamic } from "solid-js/web";
import { t } from "../../lib/i18n";
import { workLabel } from "./branchLabel";
import { type CheckState, compactGitKind, type GitStatus, gitReviewSignals, type KnState, type ReviewState } from "./taskGit";

function knLabel(state: KnState) {
  switch (state) {
    case "clean": return t("projects.kn.clean");
    case "draft": return t("projects.kn.draft");
    case "saved": return t("projects.kn.saved");
  }
}

function checkLabel(state: CheckState) {
  switch (state) {
    case "unknown": return t("projects.git.checks_unknown");
    case "none": return t("projects.git.checks_none");
    case "pending": return t("projects.git.checks_pending");
    case "success": return t("projects.git.checks_success");
    case "failure": return t("projects.git.checks_failure");
  }
}

function reviewLabel(state: ReviewState) {
  switch (state) {
    case "unknown": return t("projects.git.review_unknown");
    case "unreviewed": return t("projects.git.review_unreviewed");
    case "approved": return t("projects.git.review_approved");
    case "changes_requested": return t("projects.git.review_changes_requested");
  }
}

function ReviewSignals(props: { status?: GitStatus; size: number }) {
  const signals = () => gitReviewSignals(props.status);
  const label = (text: string) => props.status?.stale ? `${t("projects.git.stale")} · ${text}` : text;
  const check = () => {
    switch (signals()?.checks) {
      case "success": return { icon: CircleCheck, color: "text-success-strong" };
      case "failure": return { icon: CircleX, color: "text-error-strong" };
      case "pending": return { icon: CircleDashed, color: "text-warning-strong" };
      default: return null;
    }
  };
  const review = () => {
    switch (signals()?.review) {
      case "approved": return { icon: UserCheck, color: "text-success-strong" };
      case "changes_requested": return { icon: MessageSquareWarning, color: "text-warning-strong" };
      default: return null;
    }
  };
  return <>
    <Show when={check()}>{value => <span data-git-checks={signals()?.checks} class={`inline-flex shrink-0 ${props.status?.stale ? "text-neutral-500" : value().color}`} data-git-stale={props.status?.stale || undefined} title={label(checkLabel(signals()?.checks ?? "unknown"))} aria-label={label(checkLabel(signals()?.checks ?? "unknown"))}>
      <Dynamic component={value().icon} size={props.size} aria-hidden="true" />
    </span>}</Show>
    <Show when={review()}>{value => <span data-git-review={signals()?.review} class={`inline-flex shrink-0 ${props.status?.stale ? "text-neutral-500" : value().color}`} data-git-stale={props.status?.stale || undefined} title={label(reviewLabel(signals()?.review ?? "unknown"))} aria-label={label(reviewLabel(signals()?.review ?? "unknown"))}>
      <Dynamic component={value().icon} size={props.size} aria-hidden="true" />
    </span>}</Show>
  </>;
}

function gitLabels(status: GitStatus | undefined, shared: boolean) {
  const stateLabel = () => {
    const s = status;
    if (s?.kind === "kn") return s.kn ? knLabel(s.kn) : "";
    if (!s || !s.pull_known || !s.pull) return "";
    switch (s.pull.state) {
      case "open": return t("projects.git.open");
      case "draft": return t("projects.git.draft");
      case "closed": return t("projects.git.closed");
      case "merged": return s.head === s.pull.head_sha ? t("projects.git.merged") : t("projects.git.merged_other_head");
    }
  };
  const branch = () => {
    const label = workLabel(status?.branch, status?.alias);
    if (label) return label;
    if (status?.kind === "kn") return status.alias ?? "";
    return status?.kind === "detached"
      ? t("projects.git.detached", { sha: status?.head?.slice(0, 7) ?? "" })
      : t("projects.git.unknown");
  };
  const signalLabels = () => {
    const signals = gitReviewSignals(status);
    if (signals) return [checkLabel(signals.checks), reviewLabel(signals.review)].join(" · ");
    return status?.pull_known && status.pull
      && (status.pull.state === "open" || status.pull.state === "draft") && status.head !== status.pull.head_sha
      ? t("projects.git.review_other_head") : "";
  };
  const summary = () => [status?.stale ? t("projects.git.stale") : "", branch(), stateLabel(), signalLabels(), status?.pull ? `#${status.pull.number}` : "", shared ? t("projects.git.shared") : ""].filter(Boolean).join(" · ");
  return { branch, summary };
}

function gitAppearance(status?: GitStatus) {
  if (status?.kind === "kn") {
    switch (status.kn) {
      case "draft": return { icon: FilePenLine, color: "text-neutral-500" };
      case "saved": return { icon: FileCheck, color: "text-brand-purple" };
      default: return { icon: FileIcon, color: "text-neutral-500" };
    }
  }
  if (status?.kind === "detached") {
    return { icon: GitCommitHorizontal, color: "text-warning-strong" };
  }
  if (status?.pull_known && status.pull) {
    switch (status.pull.state) {
      case "open": return { icon: GitPullRequest, color: "text-success-strong" };
      case "draft": return { icon: GitPullRequestDraft, color: "text-neutral-500" };
      case "closed": return { icon: GitPullRequestClosed, color: "text-error-strong" };
      case "merged":
        if (status.head && status.head === status.pull.head_sha) return { icon: GitMerge, color: "text-brand-purple" };
    }
  }
  return { icon: GitBranch, color: "text-neutral-500" };
}

export function sessionGitDescription(status?: GitStatus) {
  return compactGitKind(status) ? gitLabels(status, !!status?.shared_with).summary() : "";
}

export default function SessionGit(props: { status?: GitStatus; compact?: boolean; shared?: boolean; lead?: JSX.Element; hasLead?: boolean }) {
  const shared = () => !!props.shared || !!props.status?.shared_with;
  const labels = () => gitLabels(props.status, shared());
  const branch = () => labels().branch();
  const summary = () => labels().summary();
  const appearance = () => {
    const value = gitAppearance(props.status);
    return props.status?.stale ? { ...value, color: "text-neutral-500" } : value;
  };
  const lineaVisible = () =>
    !!props.status && !shared() && !!(props.status.branch || props.status.kind === "detached" || props.status.kind === "kn");
  return <Show when={props.compact} fallback={
    // `lead` abre la línea (la pastilla del agente): sin git, la línea queda solo con ella.
    <Show when={lineaVisible() || props.hasLead}>
      {/* Git, checks y PR al final: misma columna que el estado del modelo. */}
      <div data-session-git={lineaVisible() ? "" : undefined} class="mt-1 flex min-w-0 items-center gap-1.5 text-[0.6875rem] font-normal leading-tight text-neutral-500">
        <Show when={props.hasLead}>{props.lead}</Show>
        <Show when={lineaVisible()}>
          {/* Un punto por debajo del resto de la línea: la rama se lee entera y queda como dato secundario. */}
          <span class="min-w-0 flex-1 truncate text-[0.625rem]" title={summary()}>{branch()}</span>
          <span class="inline-flex shrink-0 items-center gap-1">
            <span class={`inline-flex shrink-0 ${appearance().color}`} aria-label={summary()}>
              <Dynamic component={appearance().icon} size={13} aria-hidden="true" />
            </span>
            <ReviewSignals status={props.status} size={13} />
            <Show when={props.status?.pull}>
              {/* Del color del estado del PR, como su icono. */}
              <span class={`shrink-0 ${appearance().color}`}>#{props.status?.pull?.number}</span>
            </Show>
          </span>
        </Show>
      </div>
    </Show>
  }>
    <Show when={props.status && compactGitKind(props.status)}>
      <span class="inline-flex shrink-0 items-center gap-1" title={summary()} aria-label={summary()}>
        <span class={`inline-flex ${appearance().color}`}><Dynamic component={appearance().icon} size={12} aria-hidden="true" /></span>
        <ReviewSignals status={props.status} size={12} />
      </span>
    </Show>
  </Show>;
}
