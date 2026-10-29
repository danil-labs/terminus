Terminus 0.2.89 is a pre-release installer with bundled work tools. It also loads available work without waiting for an unresponsive VM and directs the composer to your chosen machine.

- **Bundled tools.** Portable Git, private Python with uv and libraries for spreadsheets, documents, presentations, PDF and images; ripgrep, native agent-browser, the draw.io viewer and Cua Driver.
- **Explicit browsing activation.** Chrome for Testing downloads when browsing is enabled, with progress, cancellation and retry. It is excluded from the base resources.
- **Lighter setup.** Node/npm and project package managers require the person's choice. Setup stops recommending Bun; existing installations are retained.
- **Activations.** Cua starts disabled. Existing activations and explicit draw.io disable decisions are preserved.
- **Recoverable updates.** The engine imports tools into separate versions and retains the previous version for recovery.
- **Loading by machine.** The web shows available tasks and saved copies while it checks other machines. Late responses update the list without duplicates, and opening a task keeps the existing rows visible.
- **Create and attach on your chosen machine.** The composer reads projects and branches from the selected machine and creates or attaches work there. Carrying work from another machine keeps its explicit workflow.
- **Sleeping VMs on your phone.** Sending a message wakes the VM even when its saved copy contains a turn that appeared active. Usage shows the saved copy and its date without waking the machine.
- **Permissions across windows.** A decision dismisses the permission notice in other windows. Linking a workspace from desktop updates the web context without reloading the page.

The engine and resources are pinned by version and SHA-256. On Linux, if AppArmor prevents Chrome from starting with its sandbox, browsing can request a rule scoped to that browser through the system authorization dialog. Creating Office files does not provide Office recalculation or rendering without LibreOffice, which remains optional.
