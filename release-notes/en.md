Terminus 0.2.77 brings the command line back to `terminus` and fixes how the engine starts on Linux.

- **`terminus <command>` works in the terminal again.** Since 0.2.75, on Windows, macOS and Linux, the Terminus executable only opened the window and commands answered "cli.error.invalid_request". It now forwards them to the engine and returns its output and exit code, including in a Windows console.
- **Linux: git over HTTPS works in tasks again.** The engine no longer inherits the AppImage's libraries or directory, and the mount is released when the window closes.