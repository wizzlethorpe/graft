// What the build prompt promises about reaching outside the world. Claiming
// nothing is downloaded and then downloading is the failure this pins.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { downloadNotice } from "../scripts/ui.mjs";

describe("downloadNotice", () => {
  const saved = { game: globalThis.game, Hooks: globalThis.Hooks };
  afterEach(() => { globalThis.game = saved.game; globalThis.Hooks = saved.Hooks; });

  const install = (...transforms) => {
    globalThis.game = { i18n: { localize: (key) => key, format: (key) => key } };
    globalThis.Hooks = { callAll: (_hook, _id, register) => transforms.forEach(register) };
  };
  const transform = (id) => ({ id, transform: () => {} });

  test("promises nothing is downloaded only when nothing is", () => {
    install();
    assert.equal(downloadNotice("m", {}), "GRAFT.PromptNoDownload");
    assert.equal(downloadNotice("m", undefined), "GRAFT.PromptNoDownload");
  });

  test("says so when the file carries assets, whoever fetches them", () => {
    install();
    assert.equal(downloadNotice("m", { http: { files: [{}] } }), "GRAFT.PromptAssets");
  });

  test("names both when the file carries assets and transforms run", () => {
    // A registered transform used to hide the assets notice entirely.
    install(transform("moulinette"));
    const notice = downloadNotice("m", { http: { files: [{}] } });
    assert.match(notice, /GRAFT\.PromptAssets/);
    assert.match(notice, /GRAFT\.PromptTransforms/);
  });

  test("names the transforms when there are any", () => {
    install(transform("moulinette"));
    assert.equal(downloadNotice("m", {}), "GRAFT.PromptTransforms");
  });
});
