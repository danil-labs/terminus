# Íconos de la app

La fuente versionada es `source-1024.png`. Regenera los íconos desde ella:

```bash
pnpm tauri icon src-tauri/icons/source-1024.png
```

Retira `android/` e `ios/` generados por el comando. Terminus distribuye la app
de escritorio. `tauri.conf.json` referencia `32x32.png`, `128x128.png`,
`128x128@2x.png`, `icon.icns` e `icon.ico`.

La fuente conserva el isotipo navy sobre fondo blanco, centrado con margen.
Ese fondo mantiene la figura visible en superficies oscuras. Para componer una
fuente nueva en macOS a partir del isotipo autorizado:

```bash
sips -Z 860 isotipo.png --out iso-fit.png
sips --padToHeightWidth 1024 1024 --padColor FFFFFF iso-fit.png --out source-1024.png
```
