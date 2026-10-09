Terminus gets a new engine. The window and the engine that does the work are now two programs: the engine keeps working on your tasks when you close the window, and the window starts it again if it goes down.

- **Your data stays where it is.** The first time you open it, Terminus hands your 0.2.74 workspaces, tasks, accounts and vault over to the new engine without copying them.
- **Close Terminus 0.2.74 first.** If it is still open, Terminus waits for its tasks to finish: nothing is forced to close.
- **To go back to 0.2.74**, close this window and wait for the engine to stop (5 minutes with no windows). Then install 0.2.74 from its release page: it opens the same data folder. If the engine does not start, Terminus tells you why and where its log is.
- **Installing and uninstalling** wait for the engine: if a task is running, the installer says so and does not install.

**Known limitation.** The live Typst preview does not work in this version: the PDF is not shown beside the document. Local sites (the `localhost` pages a task opens) do work.
