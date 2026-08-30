// The Adventure branch of hydrateOne: content documents migrate through
// their own classes, an authored id survives migration, one failure costs
// one warning, and the whole-Adventure fallback never claims otherwise.

import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const ENTRY = {
  id: "adventure0000001", type: "Adventure", pack: "adv",
  patch: {
    name: "Test",
    scenes: [{ _id: "scene00000000001", name: "S" }],
    journal: [{ _id: "journal000000001", name: "J" }],
  },
};

let created;
let sceneImportThrows;
let ctorFailures;

class FakeDoc {
  constructor(data) { this.data = data; }
  toObject() { return structuredClone(this.data); }
}
class SceneCls extends FakeDoc {
  static documentName = "Scene";
  static async fromImport(doc) {
    if (sceneImportThrows) throw new Error("no database");
    return new FakeDoc({ ...doc, migrated: true, _id: "reassigned0000ok" });
  }
}
class JournalCls extends FakeDoc {
  static documentName = "JournalEntry";
  static async fromImport(doc) {
    return new FakeDoc({ ...doc, migrated: true, _id: "reassigned0000ok" });
  }
}
class AdventureCls extends FakeDoc {
  static contentFields = { scenes: SceneCls, journal: JournalCls };
  static documentName = "Adventure";
  constructor(data) {
    if (ctorFailures > 0) { ctorFailures--; throw new Error("constructor refused"); }
    super(data);
  }
  static async create(data) { created = data; return new FakeDoc(data); }
}

beforeEach(() => {
  created = null; sceneImportThrows = false; ctorFailures = 0;
  const pack = {
    collection: "mod.adv", documentName: "Adventure", locked: false, folders: [],
    getDocument: async (id) => (created && created._id === id ? new FakeDoc(created) : null),
  };
  globalThis.game = {
    packs: { get: (c) => (c === "mod.adv" ? pack : null) },
    settings: { get: () => ({}), set: async () => {} },
  };
  globalThis.getDocumentClass = (name) =>
    ({ Adventure: AdventureCls, Scene: SceneCls, JournalEntry: JournalCls })[name];
  globalThis.foundry = { utils: { setProperty(o, p, v) {
    const ks = p.split("."); let n = o;
    for (const k of ks.slice(0, -1)) n = n[k] ??= {};
    n[ks.at(-1)] = v;
  } } };
  globalThis.fromUuid = async () => null;
  globalThis.ui = { notifications: { warn: () => {}, info: () => {} } };
});
afterEach(() => {
  for (const k of ["game", "getDocumentClass", "foundry", "fromUuid", "ui"]) delete globalThis[k];
});

async function run() {
  const { hydrate } = await import("../scripts/hydrate.mjs");
  return hydrate("mod", [ENTRY], {});
}

describe("hydrateOne, Adventure branch", () => {
  test("migrates content through each class and keeps the authored ids", async () => {
    const { built, warnings, skipped } = await run();
    assert.equal(built.length, 1, JSON.stringify(skipped));
    assert.deepEqual(warnings, []);
    assert.equal(created.scenes[0].migrated, true);
    assert.equal(created.scenes[0]._id, "scene00000000001", "fromImport's reassigned id is put back");
    assert.equal(created.journal[0].migrated, true);
  });

  test("one content document failing costs one named warning, not the Adventure", async () => {
    sceneImportThrows = true;
    const { built, warnings } = await run();
    assert.equal(built.length, 1);
    assert.equal(warnings.length, 1);
    assert.match(warnings[0].reason, /scenes scene00000000001 .*no database.*as authored/);
    assert.equal(created.scenes[0].migrated, undefined, "kept as authored");
    assert.equal(created.journal[0].migrated, true, "the rest still migrated");
  });

  test("a failing Adventure constructor falls back whole, with no as-authored claims", async () => {
    sceneImportThrows = true;
    ctorFailures = 1;          // the migrated construction fails; the fallback succeeds
    const { built, warnings } = await run();
    assert.equal(built.length, 1);
    assert.ok(warnings.some((w) => /built without migrating/.test(w.reason)), JSON.stringify(warnings));
    assert.ok(!warnings.some((w) => /as authored/.test(w.reason)),
      "per-document claims are not made when the fallback rebuilt everything unmigrated");
    assert.equal(created.scenes[0].migrated, undefined, "the fallback carried the authored data");
  });
});
