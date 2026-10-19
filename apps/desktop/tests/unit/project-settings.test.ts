import assert from "node:assert/strict";
import test from "node:test";

import { folderColor } from "../../src/lib/folderColor.ts";
import { ubicacionDeProyecto } from "../../src/lib/projectLocation.ts";

const PALETTE = ["#a78bfa", "#38bdf8", "#f59e0b", "#f472b6", "#34d399", "#fb7185", "#60a5fa", "#facc15"];

test("el color de una carpeta es estable y sale de la paleta", () => {
  for (const id of ["terminus", "p_01h9", "Contratos", ""]) {
    assert.equal(folderColor(id), folderColor(id));
    assert.ok(PALETTE.includes(folderColor(id)));
  }
});

test("el color sigue FNV-1a de 32 bits sobre el id", () => {
  // FNV-1a("") = 0x811c9dc5, FNV-1a("a") = 0xe40c292c.
  assert.equal(folderColor(""), PALETTE[0x811c9dc5 % 8]);
  assert.equal(folderColor("a"), PALETTE[0xe40c292c % 8]);
});

test("ids distintos reparten colores distintos", () => {
  const colores = new Set(Array.from({ length: 64 }, (_, i) => folderColor(`proyecto-${i}`)));
  assert.ok(colores.size >= 6);
});

test("una carpeta de disco se enseña con el home abreviado", () => {
  assert.equal(ubicacionDeProyecto("/Users/ana/code/terminus"), "~/code/terminus");
  assert.equal(ubicacionDeProyecto("/home/ana/brand", null), "~/brand");
  assert.equal(ubicacionDeProyecto(null), null);
  assert.equal(ubicacionDeProyecto("  "), null);
});

test("una carpeta en la nube se nombra por su servicio, sin la ruta interna", () => {
  assert.equal(
    ubicacionDeProyecto("/Users/ana/Library/CloudStorage/GoogleDrive-ana@danil.ai/My Drive/Danil/Contratos", "google_drive"),
    "Google Drive › Danil › Contratos",
  );
  assert.equal(
    ubicacionDeProyecto("/Users/ana/Library/Mobile Documents/com~apple~CloudDocs/Notas", "icloud"),
    "iCloud Drive › Notas",
  );
  assert.equal(
    ubicacionDeProyecto("C:\\Users\\ana\\OneDrive - Danil\\Ventas", "one_drive"),
    "OneDrive › Ventas",
  );
  assert.equal(ubicacionDeProyecto("G:\\My Drive\\Equipo", "google_drive"), "Google Drive › Equipo");
  assert.equal(ubicacionDeProyecto("/Users/ana/Library/CloudStorage/Dropbox/Fotos", "dropbox"), "Dropbox › Fotos");
});

test("una nube sin raíz reconocible conserva la ruta abreviada", () => {
  assert.equal(ubicacionDeProyecto("/Users/ana/Sync/Equipo", "other"), "~/Sync/Equipo");
  assert.equal(ubicacionDeProyecto("/Volumes/x/Equipo", "google_drive"), "/Volumes/x/Equipo");
});
