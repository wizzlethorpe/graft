// Answering "has this module built anything?" from the pack index alone.
//
// The question `unbuilt` cannot answer for a transform-backed module: its
// grafts.json names a source to fetch rather than the entries themselves, so
// there are no ids to look up until a build has already happened.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { anyBuilt, withPack } from "../scripts/modules.mjs";

const saved = globalThis.game;
afterEach(() => { globalThis.game = saved; });

/** A world where each named pack holds the given index rows. */
function installWorld(packs) {
  globalThis.game = {
    modules: {
      get: (id) => id === "southaven"
        ? { packs: [{ name: "southaven-actors" }, { name: "southaven-items" }] }
        : null,
    },
    packs: {
      get: (collection) => collection in packs
        ? { getIndex: async () => packs[collection] }
        : undefined,
    },
  };
}

const built = (id) => ({ _id: id, flags: { graft: { built: true } } });
const byHand = (id) => ({ _id: id, flags: {} });

describe("anyBuilt", () => {
  test("a freshly installed module has built nothing", async () => {
    installWorld({ "southaven.southaven-actors": [], "southaven.southaven-items": [] });
    assert.equal(await anyBuilt("southaven"), false);
  });

  test("one document in one pack is enough", async () => {
    installWorld({ "southaven.southaven-actors": [], "southaven.southaven-items": [built("a")] });
    assert.equal(await anyBuilt("southaven"), true);
  });

  test("a document the reader added by hand is not a build", async () => {
    // Without the flag check a single hand-placed actor would suppress the
    // first-build offer for good.
    installWorld({ "southaven.southaven-actors": [byHand("a")], "southaven.southaven-items": [] });
    assert.equal(await anyBuilt("southaven"), false);
  });

  test("a pack declared since the last server start is not yet readable", async () => {
    // module.json is read at server start, so a newly declared pack is absent
    // from game.packs until a restart. Absent is not the same as empty.
    installWorld({});
    assert.equal(await anyBuilt("southaven"), false);
  });

  test("a module that is not installed has built nothing", async () => {
    installWorld({ "southaven.southaven-actors": [built("a")] });
    assert.equal(await anyBuilt("not-here"), false);
  });
});

describe("withPack", () => {
  afterEach(() => { globalThis.game = saved; });

  const mod = (id, packs, flags = {}) => ({
    id, active: true, packs, flags, relationships: { requires: [{ id: "graft" }] },
  });
  const install = (...modules) => { globalThis.game = { modules: modules }; };

  test("the one pack of the entry's type is filled in", () => {
    install(mod("my-mod", [{ name: "my-scenes", type: "Scene" }]));
    assert.equal(withPack({ type: "Scene" }).pack, "my-scenes");
  });

  test("a module that declares no entries lends no pack to the guess", () => {
    // A companion module keeps packs of its own; with them counted, every Scene
    // in the author's module would have two candidates and get none.
    install(mod("my-mod", [{ name: "my-scenes", type: "Scene" }]),
      mod("graft-moulinette", [{ name: "scenes", type: "Scene" }], { graft: { entries: [] } }));
    assert.equal(withPack({ type: "Scene" }).pack, "my-scenes");
  });

  test("two candidates and no declaration is left blank", () => {
    install(mod("a", [{ name: "a-scenes", type: "Scene" }]), mod("b", [{ name: "b-scenes", type: "Scene" }]));
    assert.equal("pack" in withPack({ type: "Scene" }), false);
  });
});
