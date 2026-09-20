// What the build prompt promises about reaching outside the world. Claiming
// nothing is downloaded and then downloading is the failure this pins.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { downloadNotice, graftsFile, fileFor } from "../scripts/ui.mjs";

describe("downloadNotice", () => {
  const saved = globalThis.game;
  afterEach(() => { globalThis.game = saved; });
  const install = () => { globalThis.game = { i18n: { localize: (key) => key, format: (key) => key } }; };

  test("promises nothing is downloaded only when nothing is", () => {
    install();
    assert.equal(downloadNotice({}), "GRAFT.PromptNoDownload");
    assert.equal(downloadNotice(undefined), "GRAFT.PromptNoDownload");
  });

  test("says so when the file carries assets, whoever fetches them", () => {
    install();
    assert.equal(downloadNotice({ moulinette: { files: [{}] } }), "GRAFT.PromptAssets");
  });
});

describe("graftsFile", () => {
  const entries = [{ id: "a", type: "Actor", patch: {} }];

  test("carries the assets block a copy's handlers listed", () => {
    const file = JSON.parse(graftsFile(entries, { lib: { files: ["a.png"] } }));
    assert.deepEqual(file.assets, { lib: { files: ["a.png"] } });
    assert.deepEqual(file.entries, entries);
  });

  test("has no assets key when no handler listed anything", () => {
    assert.equal("assets" in JSON.parse(graftsFile(entries, undefined)), false);
  });
});

describe("fileFor", () => {
  const saved = { game: globalThis.game, ui: globalThis.ui, Hooks: globalThis.Hooks };
  afterEach(() => Object.assign(globalThis, saved));

  test("tells the reader why, and copies nothing, when a handler cannot list its files", async () => {
    const errors = [];
    globalThis.game = { i18n: { localize: (key) => key, format: (key, data) => `${key} ${data.reason}` } };
    globalThis.ui = { notifications: { error: (message) => errors.push(message) } };
    globalThis.Hooks = { callAll: (_hook, register) => register({ id: "lib", place() {}, collect: () => { throw new Error("signed out"); } }) };
    assert.equal(await fileFor([{ id: "a", type: "Actor", patch: {} }]), null);
    assert.deepEqual(errors, ["GRAFT.CopyFailed signed out"]);
  });
});
