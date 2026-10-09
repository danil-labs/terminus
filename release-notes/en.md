Terminus gets a new engine. The window and the engine that does the work are now two programs: the engine keeps working on your tasks when you close the window, and the window starts it again if it goes down.

- **Your data stays where it is.** The first time, Terminus hands your workspaces, tasks, accounts and vault over to the new engine without copying them. It asks you to close Terminus 0.2.74 and waits for its tasks to finish: nothing is forced to close.
- **If the engine does not start**, Terminus tells you why, where its log is and how to go back to 0.2.74, which opens the same data folder.
- **Installing and uninstalling** wait for the engine: if a task is running, the installer says so and does not install.

**Known limitation.** The live Typst preview does not work in this version: the PDF is not shown beside the document. Local sites (the `localhost` pages a task opens) do work.
