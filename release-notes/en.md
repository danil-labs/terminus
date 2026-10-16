Terminus 0.2.82 lets you close the window without stopping your agents, tells you when a task needs you, and updates on Windows without closing.

- **Closing with agents working asks what to do.** You can keep working in the background, with an icon next to the clock that shows what is running and lets you open, stop or quit, or stop the tasks and quit. If you choose to remember your answer, change it in Settings → General.
- **Task notifications.** With Terminus hidden or minimized, a system notification tells you when a task asks you something, asks for permission, fails or finishes; clicking it opens that task. On screen but behind another app, its taskbar button flashes. Inside Terminus, on another task, a notice with "Open" appears. Choose in Settings → General.
- **Updating on Windows without closing Terminus.** The installer no longer asks you to close the app. If tasks are working, the new engine takes over as soon as the old one runs out of work.
- **Shutting down or signing out with tasks working no longer shows error windows.** Running tasks are left as interrupted.
- **GitHub per workspace.** When you connect GitHub you choose which organizations and repositories each workspace uses, and you can change them without signing in again. Settings offers to install `gh` if you do not have it.
- **A single window.** Opening Terminus again brings the open window to the front.
- **The window opens where you left it**, with its size, maximized or fullscreen.
- **Live Typst view.** The document compiles as you type, next to the code, and the view recovers on its own if it loses contact with the engine. Esc in the chat no longer leaves the preview, and the editor keeps the keyboard when the view opens.
- **Interactive charts in the chat**, with filters and sliders.
- **Tables fit their content.** Columns no longer break short words, and their borders can be dragged.
- **Tabs.** The active one blends with its conversation, the strip no longer jumps when you click a tab, and it scrolls with the wheel or by dragging its bar.
- **Dropping a file attaches it to the conversation under the pointer**, also with the screen split.
- **Compact attachments.** Images in a sent message show as thumbnails in one row.
- **Aligned `!` commands.** The composer indents terminal commands after the `!`.
- **Plugin skills reach the agents** even with several tasks working at once. With Typst on, the agent uses Terminus's Typst.
- **The `!` command on macOS and Linux** finds `npm` and the other tools of your terminal, and shows when the command failed.
- **Smaller fixes:** a task keeps its provider when you switch workspace; `/btw` keeps its color in the graphite dark theme; the active Settings tab no longer drifts from its panel when zoomed; tasks launched from another folder show in their own folder; Git indicators no longer vanish when a window closes; the theme is kept on restart; the "part of the live output is missing" notice no longer shows falsely; Windows paths written as `/C:/` open; the rocket flame lines up with its nozzle.
