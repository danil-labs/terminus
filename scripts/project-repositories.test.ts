import assert from "node:assert/strict";
import { test } from "node:test";
import { mergeRepositories, repositoryIdentity } from "../src/lib/projectRepositories.ts";

test("SSH e HTTPS muestran un repositorio y conservan el proveedor accesible", () => {
  const history = [{ name: "Acme/app", url: "git@github.com:Acme/app.git", provider: null, last_used: 42 }];
  const accessible = [{ name: "acme/app", url: "https://github.com/acme/app.git", provider: "github", last_used: 0 }];
  const merged = mergeRepositories(history, accessible);
  assert.equal(merged.length, 1);
  assert.equal(merged[0].provider, "github");
  assert.equal(merged[0].last_used, 42);
  assert.equal(merged[0].project, undefined);
  assert.equal(repositoryIdentity(history[0].url), repositoryIdentity(accessible[0].url));
  assert.notEqual(repositoryIdentity("https://bitbucket.org/acme/app"), repositoryIdentity(accessible[0].url));
});

test("el historial sigue disponible sin proveedor y la búsqueda incluye organización", () => {
  const history = [{ name: "app", url: "https://git.example.org/customer/app.git", provider: null, last_used: 42 }];
  assert.deepEqual(mergeRepositories(history, [], "CUSTOMER"), history);
  assert.deepEqual(mergeRepositories(history, [], "other-customer"), []);
});

test("el usuario de una URL de Bitbucket no duplica su entrada de historial", () => {
  const history = [{ name: "team/app", url: "https://bitbucket.org/team/app.git", provider: "bitbucket", last_used: 1 }];
  const accessible = [{ name: "team/app", url: "https://alice@bitbucket.org/team/app.git", provider: "bitbucket", last_used: 0 }];
  const repos = mergeRepositories(history, accessible);
  assert.equal(repos.length, 1);
  assert.equal(repos[0].url, "https://bitbucket.org/team/app.git");
});

test("el clon local del historial sobrevive a la fila accesible del proveedor", () => {
  const history = [{ name: "acme/app", url: "git@github.com:acme/app.git", provider: null, last_used: 42, project: "p1", local_path: "/code/app" }];
  const accessible = [{ name: "acme/app", url: "https://github.com/acme/app.git", provider: "github", last_used: 0 }];
  const [repo] = mergeRepositories(history, accessible);
  assert.equal(repo.provider, "github");
  assert.equal(repo.project, "p1");
  assert.equal(repo.local_path, "/code/app");
});
