Terminus 0.2.76 fixes an update that would stall on Windows and two confusing window notices.

- **The Windows update no longer stalls.** If an agent account had saved embedded-browser (WebView2) caches in the data folder, the new engine now accepts it: before, updating from 0.2.74 would stop with "The engine does not accept this data folder."
- **The title bar now says it's the engine.** The number shown at the top right is the engine's version, not Terminus's; it now reads, for example, "engine 0.2.73 fa6d965."
- **An incomplete live-output notice no longer appears** after the engine restarts with no work in progress.
