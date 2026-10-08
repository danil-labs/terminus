import assert from "node:assert/strict";
import test from "node:test";
import { releaseNotes } from "../src/lib/releaseNotes.ts";

const rawJson = { notes_by_locale: { es: "Nota", en: "Note" } };

test("the note comes from the app's language", () => {
  assert.equal(releaseNotes({ body: "Body", rawJson }, "es"), "Nota");
  assert.equal(releaseNotes({ body: "Body", rawJson }, "en"), "Note");
  assert.equal(releaseNotes({ body: "Body", rawJson }, "es-MX"), "Nota");
});

test("it falls back to body when the language has no note", () => {
  assert.equal(releaseNotes({ body: "Body", rawJson }, "yua"), "Body");
  assert.equal(releaseNotes({ body: "Body", rawJson: { notes_by_locale: { en: "  " } } }, "en"), "Body");
  assert.equal(releaseNotes({ body: "Body", rawJson: {} }, "es"), "Body");
  assert.equal(releaseNotes({ rawJson: { notes_by_locale: null } }, "es"), "");
});
