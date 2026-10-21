import type * as NotificationsModule from "expo-notifications";

/** En el navegador no hay avisos del sistema (todavía): la campana de la app sigue contando lo que te necesita. */
export const Notifications: typeof NotificationsModule | null = null;
