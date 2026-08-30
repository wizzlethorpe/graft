// Answering "has this module built anything?" from the pack index alone.
//
// The question `unbuilt` cannot answer for a provider-backed module: its
// grafts.json names a source to fetch rather than the entries themselves, so
// there are no ids to look up until a build has already happened.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { anyBuilt } from "../scripts/modules.mjs";

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
