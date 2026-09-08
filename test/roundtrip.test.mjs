// The fixpoint: build an entry, change nothing, Copy graft, get the entry back.
//
// patch.test.mjs pins the round trip through `diff` and `applyPatch` alone,
// which cannot see the build dropping something the export step reads back.

import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installWorld, uninstallWorld } from "./foundry-stub.mjs";

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

beforeEach(() => { ({ collections } = installWorld({ types: ["Actor", "Item"], sources: SOURCES })); });
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
