import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const workflows = new Map([
  ["desktop-ci", readFileSync(".github/workflows/desktop-ci.yml", "utf8")],
  ["release-desktop", readFileSync(".github/workflows/release-desktop.yml", "utf8")],
]);

const approvedActions = new Map([
  ["actions/checkout", {
    ref: "3d3c42e5aac5ba805825da76410c181273ba90b1",
    version: "v7.0.1",
  }],
  ["actions/setup-node", {
    ref: "820762786026740c76f36085b0efc47a31fe5020",
    version: "v7.0.0",
  }],
  ["pnpm/action-setup", {
    ref: "0977fd99725f1db4007ccb2928dbb4e90d06cc86",
    version: "v6.0.10",
  }],
]);

const actionPattern = /^\s*uses:\s*(actions\/checkout|actions\/setup-node|pnpm\/action-setup)@([^\s#]+)(?:\s+#\s*(v\d+\.\d+\.\d+))?\s*$/gm;

function actionReferences(source) {
  return [...source.matchAll(actionPattern)].map((match) => ({
    action: match[1],
    ref: match[2],
    version: match[3],
  }));
}

test("pins every JavaScript setup action to the reviewed Node 24 release commit", () => {
  const references = [...workflows.values()].flatMap(actionReferences);
  assert.equal(references.length, 9);

  for (const reference of references) {
    const approved = approvedActions.get(reference.action);
    assert.deepEqual(reference, {
      action: reference.action,
      ...approved,
    });
  }
});

test("runs this contract in normal CI and before release packaging", () => {
  const desktopCi = workflows.get("desktop-ci");
  const releaseDesktop = workflows.get("release-desktop");
  const desktopContract = desktopCi.indexOf("run: pnpm test:actions");
  const releaseContract = releaseDesktop.indexOf("run: pnpm test:actions");

  assert.ok(desktopContract > desktopCi.indexOf("name: Setup Node"));
  assert.ok(desktopContract < desktopCi.indexOf("name: Install dependencies"));
  assert.ok(releaseContract > releaseDesktop.indexOf("name: Setup pnpm"));
  assert.ok(releaseContract < releaseDesktop.indexOf("name: Package Windows"));
  assert.match(releaseDesktop, /build-mac:\s*[\s\S]*?needs:\s*build-windows/);
});

test("keeps the project toolchain versions explicit", () => {
  assert.match(workflows.get("desktop-ci"), /node-version:\s*22/);
  assert.match(workflows.get("desktop-ci"), /version:\s*10/);
  assert.equal((workflows.get("release-desktop").match(/node-version:\s*'22'/g) ?? []).length, 2);
  assert.equal((workflows.get("release-desktop").match(/version:\s*9/g) ?? []).length, 2);
});

test("does not persist checkout credentials into build and packaging steps", () => {
  const sources = [...workflows.values()].join("\n");
  assert.equal((sources.match(/persist-credentials:\s*false/g) ?? []).length, 3);
});

test("contains no orphan gitlinks that break checkout credential cleanup", () => {
  const index = execFileSync("git", ["ls-files", "--stage"], { encoding: "utf8" });
  const gitlinks = [...index.matchAll(/^160000\s+[a-f0-9]{40}\s+\d+\t(.+)$/gm)]
    .map((match) => match[1]);
  const declaredSubmodules = new Set();

  if (existsSync(".gitmodules")) {
    const config = execFileSync(
      "git",
      ["config", "--file", ".gitmodules", "--get-regexp", "^submodule\\..*\\.path$"],
      { encoding: "utf8" },
    );
    for (const line of config.trim().split(/\r?\n/)) {
      const [, modulePath] = line.split(/\s+/, 2);
      if (modulePath) declaredSubmodules.add(modulePath);
    }
  }

  assert.deepEqual(gitlinks.filter((gitlink) => !declaredSubmodules.has(gitlink)), []);
});
