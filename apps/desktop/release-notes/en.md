Terminus 0.2.88 is a local installer candidate with bundled work tools. It has not been published.

- **Bundled tools.** Portable Git, private Python with uv and libraries for spreadsheets, documents, presentations, PDF and images; ripgrep, native agent-browser, the draw.io viewer and Cua Driver.
- **Explicit browsing activation.** Chrome for Testing downloads when browsing is enabled, with progress, cancellation and retry. It is excluded from the base resources.
- **Lighter setup.** Node/npm and project package managers require the person's choice. Setup stops recommending Bun; existing installations are retained.
- **Activations.** Cua starts disabled. Existing activations and explicit draw.io disable decisions are preserved.
- **Recoverable updates.** The engine imports tools into separate versions and retains the previous version for recovery.

The candidate uses a local engine and SHA-256-pinned resources; the published engine lock remains separate. Native macOS and Windows verification and the universal macOS installer size remain pending. Creating Office files does not provide Office recalculation or rendering without LibreOffice, which remains optional.
