Terminus 0.2.79 updates to the latest version without a restart and starts reliably.

- **It always installs the latest version.** Before, it installed the one it found at launch even when a newer one existed, so it advanced one version at a time.
- **You see the update without closing the app.** Terminus checks every 30 minutes and when you return to the window, instead of every 6 hours.
- **"The Terminus engine did not start" no longer appears when the computer is slow.** The window waits for the engine while it is alive, and on Windows the engine no longer checks every account folder before starting: it does it afterwards, in the background.
