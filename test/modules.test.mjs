// Answering "has this module built anything?" from the pack index alone.
//
// The question `unbuilt` cannot answer for a transform-backed module: its
// grafts.json names a source to fetch rather than the entries themselves, so
// there are no ids to look up until a build has already happened.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { FORMAT, anyBuilt, formatOf, readFile, readGrafts, unbuilt, withPack } from "../scripts/modules.mjs";
import { adventureId } from "../scripts/plan.mjs";

describe("the grafts file shape", () => {
  test("takes the object a grafts.json is", () => {
    assert.deepEqual(readFile({ format: 1, entries: [{ id: "a" }] }).entries, [{ id: "a" }]);
  });

  test("refuses the old bare list under its own name, so the warning can say so", () => {
    assert.equal(readFile([{ id: "a" }]).error, "old-format");
  });

  test("refuses an object with no entries list", () => {
    assert.equal(readFile({ format: 1 }).error, "no-entries");
  });

  test("reads a file that declares no format as the first one", () => {
    assert.equal(formatOf({ entries: [] }), 1);
  });

  test("refuses a format that is not a whole number, a semver string included", () => {
    assert.equal(formatOf({ format: "1.0.0" }), null);
    assert.equal(formatOf({ format: "1" }), null);
    assert.equal(formatOf({ format: true }), null);
  });

  test("names the newer format, so the reader can be told which", () => {
    const result = readFile({ format: FORMAT + 1, entries: [] });
    assert.equal(result.error, "new-format");
    assert.equal(result.format, FORMAT + 1);
  });
});

describe("readGrafts on a file it will not read", () => {
  const warn = console.warn;
  afterEach(() => { console.warn = warn; delete globalThis.fetch; });

  /** A module whose grafts.json holds whatever is passed. */
  function installModuleFile(body) {
    console.warn = () => {};
    globalThis.game = { modules: { get: () => ({ flags: {} }) } };
    globalThis.fetch = async () => ({ ok: true, json: async () => body });
  }

  test("builds the entries of a file it can read", async () => {
    installModuleFile({ format: FORMAT, entries: [{ id: "a" }] });
    assert.deepEqual(await readGrafts("m"), [{ id: "a" }]);
  });

  test("builds nothing from a bare list, and reports which refusal it was", async () => {
    installModuleFile([{ id: "a" }]);
    const refused = [];
    assert.deepEqual(await readGrafts("m", { onRefused: (r) => refused.push(r.error) }), []);
    assert.deepEqual(refused, ["old-format"]);
  });

  test("builds nothing from a format it does not understand", async () => {
    installModuleFile({ format: FORMAT + 1, entries: [{ id: "a" }] });
    assert.deepEqual(await readGrafts("m"), []);
  });
});

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

  test("an Adventure pack takes any type, when nothing closer exists", () => {
    install(mod("tryk", [{ name: "tryk-adventure", type: "Adventure" }]));
    assert.equal(withPack({ type: "Scene" }).pack, "tryk-adventure");
  });

  test("a pack of the entry's own type beats an Adventure pack", () => {
    install(mod("m", [{ name: "m-scenes", type: "Scene" }, { name: "m-adventure", type: "Adventure" }]));
    assert.equal(withPack({ type: "Scene" }).pack, "m-scenes");
  });
});

describe("unbuilt, for an Adventure pack", () => {
  afterEach(() => { globalThis.game = saved; delete globalThis.fetch; });

  /** A module whose two entries aim at one Adventure pack, holding `adventure` if built. */
  function install(adventure) {
    globalThis.fetch = async () => ({ ok: true, json: async () => ({ format: FORMAT, entries: [
      { id: "aaaaaaaaaaaaaaaa", type: "Actor", pack: "adv" },
      { id: "bbbbbbbbbbbbbbbb", type: "Scene", pack: "adv" },
    ] }) });
    globalThis.game = {
      modules: { get: () => ({ flags: {} }) },
      packs: { get: (c) => (c === "m.adv"
        ? { documentName: "Adventure", getDocument: async (id) => (id === adventureId("m", "adv") ? adventure : null) }
        : undefined) },
    };
  }

  test("looks for entries inside the Adventure, since the index knows only the wrapper", async () => {
    install({ actors: [{ _id: "aaaaaaaaaaaaaaaa" }], scenes: [] });
    assert.deepEqual((await unbuilt("m")).map((e) => e.id), ["bbbbbbbbbbbbbbbb"]);
  });

  test("no Adventure yet means nothing is built", async () => {
    install(null);
    assert.equal((await unbuilt("m")).length, 2);
  });
});
