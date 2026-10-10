Terminus 0.2.78 removes the macOS keychain prompt when updating.

- **macOS: no keychain dialog when updating from 0.2.74.** Before, first use asked for the login password because the new engine read the vault key on its own. Now the window, which the keychain already trusts, hands it to the engine over a private channel.
