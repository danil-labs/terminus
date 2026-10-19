import type * as NotificationsModule from "expo-notifications";

/**
 * `expo-notifications`, or null where it cannot load. Expo Go on Android has
 * no notification native modules since SDK 53 and importing the package there
 * throws; a development build has them.
 */
function load(): typeof NotificationsModule | null {
  try {
    return require("expo-notifications") as typeof NotificationsModule;
  } catch {
    return null;
  }
}

export const Notifications = load();
