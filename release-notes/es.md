Terminus 0.2.80 arranca en segundos aunque lleves varias versiones instaladas.

- **Arranque rápido en Windows.** Cada actualización o cierre forzado del motor dejaba un registro de un proceso que ya no existía, y al arrancar el motor intentaba conectarse a cada uno, unos 2 s por registro. Ahora los descarta sin conectarse, y el arranque vuelve a tardar unos segundos.
