Terminus 0.2.89 is a pre-release installer with bundled work tools.

- **Bundled tools.** Portable Git, private Python with uv and libraries for spreadsheets, documents, presentations, PDF and images; ripgrep, native agent-browser, the draw.io viewer and Cua Driver.
- **Explicit browsing activation.** Chrome for Testing downloads when browsing is enabled, with progress, cancellation and retry. It is excluded from the base resources.
- **Lighter setup.** Node/npm and project package managers require the person's choice. Setup stops recommending Bun; existing installations are retained.
- **Activations.** Cua starts disabled. Existing activations and explicit draw.io disable decisions are preserved.
- **Recoverable updates.** The engine imports tools into separate versions and retains the previous version for recovery.

The engine and resources are pinned by version and SHA-256. On Linux, if AppArmor prevents Chrome from starting with its sandbox, browsing can request a rule scoped to that browser through the system authorization dialog. Creating Office files does not provide Office recalculation or rendering without LibreOffice, which remains optional.
