Terminus 0.2.80 starts in seconds even after several updates.

- **Fast startup on Windows.** Each update or forced engine shutdown left behind a record of a process that no longer existed, and on startup the engine tried to connect to each one, about 2 s per record. It now discards them without connecting, and startup takes a few seconds again.
