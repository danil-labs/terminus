Terminus 0.2.87 fixes updating on Linux and brings several fixes across machines.

- **Enterprise usage.** Organizations that enable reporting can recover historical usage from the workspace linked to their account, with automatic delivery and no double counting of records already received.
- **Storage by machine.** View disk usage for each machine and direct cleanup to the selected machine and workspace. Capacity and free space refer to the volume hosting the engine. On mobile web, open Storage within usage to see each machine’s disk and measure the workspace.
- **Updating on Linux.** If your Terminus folder came from an earlier version with group permissions (umask 002, the Ubuntu default), the new engine no longer refuses to start with "authority_incompatible": it removes that permission from its own folders and carries on, without touching your data. With that umask, a fresh install starts too.
- **Tasks on another machine.** The file tree of a task running on another machine is read on that machine, and an image you attach on the Mac reaches the task's machine.
- **Phone.** What an agent or another task writes to you shows on the left, with its name, and the message you send to a powered-off VM stays visible while it starts.
- **Typst.** The live preview opens without choosing the main file first.
