// The fixpoint: build an entry, change nothing, Copy graft, get the entry back.
//
// patch.test.mjs pins the round trip through `diff` and `applyPatch` alone,
// which cannot see the build dropping something the export step reads back.

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installWorld, serveFiles, uninstallWorld } from "./foundry-stub.mjs";

const BANDIT = "Compendium.mm.actors.Actor.mmBandit00000000";
const CROSSBOW = "Compendium.phb.equipment.Item.phbLightCrossbo";
const AMULET = "Compendium.dmg.equipment.Item.dmgAmuletOfHealt";
const STATS = { coreVersion: "14.367", systemId: "dnd5e", systemVersion: "5.3.3" };

// Every document in a pack sits in one of that pack's folders, and that id
// means nothing anywhere else.
const SOURCES = {
  [BANDIT]: {
    _id: "mmBandit00000000", name: "Bandit", type: "npc", _stats: STATS, folder: "packFolderMM001",
    items: [{ _id: "itemScimitar0001", name: "Scimitar" }, { _id: "itemPistol000001", name: "Pistol" }],
  },
  [CROSSBOW]: {
    _id: "phbLightCrossbo", name: "Light Crossbow", type: "weapon", _stats: STATS, folder: "packFolderPHB01",
    system: { damage: "1d8", licensed: "PHB text" },
    effects: [{ _id: "fxShared00000001", name: "Crossbow Aura", type: "equipment",
                system: { licensed: "DMG text" } }],
  },
  [AMULET]: {
    _id: "dmgAmuletOfHealt", name: "Amulet of Health", type: "equipment", _stats: STATS, folder: "packFolderDMG01",
    system: { licensed: "DMG text" },
  },
};

let collections;
let WorldDoc;

beforeEach(() => { ({ collections, WorldDoc } = installWorld({ types: ["Actor", "Item"], sources: SOURCES })); });
afterEach(uninstallWorld);

/** Build one entry into the stub world, then recover it with Copy graft. */
async function roundTrip(entry, also = []) {
  const { hydrateWorld, exportDiff } = await import("../scripts/hydrate.mjs");
  const report = await hydrateWorld(structuredClone([...also, entry]), {});
  assert.deepEqual(report.skipped, [], "the entry built");
  return exportDiff(collections.get(entry.type).get(entry.id));
}

/** Minus `pack`, which only the build knows, and `sourceHash`, which is derived. */
const comparable = ({ pack: _p, sourceHash: _h, ...rest }) => rest;

const actorEntry = (patch) => ({ id: "aBuiltActor00001", type: "Actor", pack: "kit", source: BANDIT, patch });

test("an embedded source comes back as a reference, not a copy", async () => {
  // The build merges the item in, leaving nothing that says it is somebody
  // else's, so the next export shipped its whole licensed body.
  const entry = actorEntry({ items: [{ _id: "rNtwCrossbow0001", source: CROSSBOW, patch: { system: { equipped: true } } }] });

  const back = await roundTrip(entry);
  assert.deepEqual(comparable(back), comparable(entry));
  assert.equal(JSON.stringify(back).includes("PHB text"), false, "their text does not travel");
  assert.ok(!("sourceHash" in back), "a reference touches nothing that could drift");
});

test("a sibling built into this world is not recorded as a source", async () => {
  // Its uuid resolves only here, so shipping it hands a reader a source they
  // cannot have, and the entry naming it is skipped rather than built.
  const sword = { id: "myOwnSword000001", type: "Item", pack: "kit", patch: { name: "Sword", type: "weapon" } };
  const entry = actorEntry({
    items: [{ _id: "rNtwSword0000001", source: "myOwnSword000001", patch: { system: { equipped: true } } }],
  });

  const back = await roundTrip(entry, [sword]);
  assert.equal(JSON.stringify(back).includes("Item.myOwnSword000001"), false, "no world uuid travels");
  assert.equal(back.patch.items[0].name, "Sword", "the member travels whole instead");
});

test("an embedded source inside an embedded source comes back too", async () => {
  const entry = actorEntry({
    items: [{
      _id: "rNtwCrossbow0001", source: CROSSBOW,
      patch: { effects: [{ _id: "fxAmulet00000001", source: AMULET, patch: { name: "Warded" } }] },
    }],
  });

  const back = await roundTrip(entry);
  assert.deepEqual(comparable(back), comparable(entry));
  const json = JSON.stringify(back);
  assert.equal(json.includes("PHB text"), false, "the outer body does not travel");
  assert.equal(json.includes("DMG text"), false, "nor the inner one");
});

test("graft's own build flag does not read as a change", async () => {
  // Every build writes flags.graft.built. Stripping it left `flags: {}` behind,
  // so an untouched document reported a difference on every export.
  const entry = actorEntry({ name: "Vigilante" });
  assert.deepEqual(comparable(await roundTrip(entry)), comparable(entry));
});

test("a removal survives the build", async () => {
  // Also the only cover for `expandSources` passing the sentinel through
  // rather than treating it as a member to expand.
  const entry = actorEntry({ items: [{ _id: "itemPistol000001", _delete: true }] });
  assert.deepEqual(comparable(await roundTrip(entry)), comparable(entry));
});

test("a second cycle changes nothing, sourceHash included", async () => {
  const entry = actorEntry({ items: [{ _id: "rNtwCrossbow0001", source: CROSSBOW, patch: { system: { equipped: true } } }] });
  const once = await roundTrip(entry);
  const twice = await roundTrip({ ...once, pack: entry.pack });
  assert.deepEqual(twice, once);
});

test("a nested source reusing an id the outer source has loses fields", async () => {
  // A known limit, and why it is not fixed, are in TODO.md. Reachable only
  // because the crossbow fixture carries the fields the amulet contributes.
  const back = await roundTrip(actorEntry({
    items: [{
      _id: "rNtwCrossbow0001", source: CROSSBOW,
      patch: { effects: [{ _id: "fxShared00000001", source: AMULET, patch: { name: "Warded" } }] },
    }],
  }));

  const effect = back.patch.items[0].patch.effects[0];
  assert.equal(effect.source, AMULET, "still a reference, so no body travels");
  assert.deepEqual(effect.patch, { name: "Warded", type: null, system: null });
});

// ── a file source ───────────────────────────────────────────────────────────

test("a document built from a file comes back as that file and the changes to it", async () => {
  // A path is not a uuid, so Foundry's own source field cannot hold it, and graft keeps the record itself.
  serveFiles({ "graft/kit/guard.json": { name: "Guard", type: "npc", system: { hp: 10, licensed: "their text" } } });
  const entry = { id: "aBuiltActor00002", type: "Actor", pack: "kit", source: "graft/kit/guard.json", patch: { name: "Captain" } };

  const back = await roundTrip(entry);
  assert.deepEqual(comparable(back), comparable(entry));
  assert.equal(JSON.stringify(back).includes("their text"), false, "the file's content does not travel");
});

test("a file's own stamp from wherever its publisher exported it does not become the source", async () => {
  serveFiles({ "graft/kit/guard.json": { name: "Guard", type: "npc", _stats: { ...STATS, compendiumSource: "Compendium.private.work.Actor.aaaaaaaaaaaaaaaa" } } });
  const entry = { id: "aBuiltActor00002", type: "Actor", pack: "kit", source: "graft/kit/guard.json", patch: { name: "Captain" } };
  assert.equal((await roundTrip(entry)).source, "graft/kit/guard.json");
});

test("an embedded member built from a file comes back as a reference to it", async () => {
  serveFiles({ "graft/kit/amulet.json": { name: "Amulet", type: "equipment", system: { licensed: "their text" } } });
  const entry = actorEntry({ items: [{ _id: "rNtwAmulet000001", source: "graft/kit/amulet.json", patch: { system: { equipped: true } } }] });

  const back = await roundTrip(entry);
  assert.deepEqual(comparable(back), comparable(entry));
  assert.equal(JSON.stringify(back).includes("their text"), false);
});

test("what a source remembers about itself is not inherited by what is built on it", async () => {
  // The guard came from a file. The captain came from the guard, and says so: by uuid from a pack, by nothing from a sibling.
  serveFiles({ "graft/kit/guard.json": { name: "Guard", type: "npc" } });
  const guard = { id: "aBuiltActor00002", type: "Actor", pack: "kit", source: "graft/kit/guard.json", patch: {} };
  const captain = { id: "aBuiltActor00004", type: "Actor", pack: "kit", source: "aBuiltActor00002", patch: { name: "Captain" } };
  const back = await roundTrip(captain, [guard]);
  assert.ok(!("source" in back), "a sibling resolves only in this world, so nothing is recorded, the file included");
  assert.equal(back.patch.name, "Captain");
});

test("Foundry's stamp wins over the file graft recorded, since a drag out of a pack is the newer fact", async () => {
  const { exportDiff } = await import("../scripts/hydrate.mjs");
  const doc = new WorldDoc({ _id: "aDraggedActor001", __type: "Actor", name: "Bandit", type: "npc",
    flags: { graft: { source: "graft/kit/guard.json" } }, _stats: { ...STATS, compendiumSource: BANDIT } });
  assert.equal((await exportDiff(doc)).source, BANDIT);
});

test("a document whose file has gone refuses to export, since the whole document would travel in its place", async () => {
  serveFiles({ "graft/kit/guard.json": { name: "Guard", type: "npc" } });
  const { hydrateWorld, exportDiff } = await import("../scripts/hydrate.mjs");
  await hydrateWorld([{ id: "aBuiltActor00003", type: "Actor", source: "graft/kit/guard.json", patch: { name: "Captain" } }], {});
  serveFiles({});
  await assert.rejects(exportDiff(collections.get("Actor").get("aBuiltActor00003")), /graft\/kit\/guard\.json, which is not on disk, or holds no document/);
});

test("recordFileSource clears the stamp a document was imported with, which would otherwise win", async () => {
  const { recordFileSource } = await import("../scripts/hydrate.mjs");
  const updates = [];
  await recordFileSource({ update: async (data) => updates.push(data) }, "graft/moulinette/1/scene.json");
  assert.deepEqual(updates, [{ "flags.graft.source": "graft/moulinette/1/scene.json", "_stats.compendiumSource": null }]);
});
