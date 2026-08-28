// The properties the format has to have, and the one it deliberately does not.
//
// The load-bearing claim is the round trip: `applyPatch(source, diff(source,
// mine))` must equal `mine`. If that holds, editing a document in Foundry and
// shipping the recovered patch reproduces exactly what you edited on somebody
// else's machine, which is the entire product.

import test from "node:test";
import assert from "node:assert/strict";

import { applyPatch, diff, isKeyedArray } from "../scripts/patch.mjs";

const BANDIT = {
  _id: "mmBandit00000000",
  name: "Bandit",
  system: {
    attributes: { hp: { value: 11, max: 11 }, ac: { value: 12 } },
    details: { cr: 0.125, type: { value: "humanoid" } },
  },
  items: [
    { _id: "itemScimitar001", name: "Scimitar", system: { damage: "1d6" } },
    { _id: "itemCrossbow001", name: "Light Crossbow", system: { damage: "1d8" } },
  ],
};

test("a patch mirrors the document's shape", () => {
  const out = applyPatch(BANDIT, { name: "Marlo's Enforcer" });
  assert.equal(out.name, "Marlo's Enforcer");
  assert.equal(out.system.attributes.hp.value, 11, "untouched branches survive");
});

test("null deletes, as RFC 7386 says", () => {
  const out = applyPatch(BANDIT, { system: { details: { cr: null } } });
  assert.ok(!("cr" in out.system.details));
  assert.equal(out.system.details.type.value, "humanoid", "its siblings stay");
});

test("the source is never mutated", () => {
  // Hydration patches a document read out of somebody else's pack. Mutating
  // it in place would corrupt the pack for everything else in the session.
  const before = JSON.stringify(BANDIT);
  applyPatch(BANDIT, { name: "Changed", items: [{ _id: "itemScimitar001", name: "X" }] });
  assert.equal(JSON.stringify(BANDIT), before);
});

test("keyed arrays merge by _id instead of replacing", () => {
  // The one departure from the standard. Changing one item's damage must not
  // mean restating every item, and must survive the source reordering them.
  const out = applyPatch(BANDIT, {
    items: [{ _id: "itemCrossbow001", system: { damage: "2d8" } }],
  });
  assert.equal(out.items.length, 2, "the untouched item is still there");
  assert.equal(out.items.find((i) => i._id === "itemCrossbow001").system.damage, "2d8");
  assert.equal(out.items.find((i) => i._id === "itemCrossbow001").name, "Light Crossbow",
    "and keeps the fields the patch did not mention");
});

test("an unkeyed array replaces wholesale", () => {
  // Only arrays of embedded documents have keys. A list of strings is a value.
  const src = { languages: ["Common", "Thieves' Cant"] };
  assert.deepEqual(applyPatch(src, { languages: ["Common"] }).languages, ["Common"]);
  assert.equal(isKeyedArray(["a", "b"]), false);
  assert.equal(isKeyedArray([]), false, "an empty array has no keys to merge on");
});

test("a patch can add an item the source never had", () => {
  const out = applyPatch(BANDIT, {
    items: [{ _id: "itemAmulet00001", name: "Amulet", system: {} }],
  });
  assert.equal(out.items.length, 3);
});

// ── the authoring half ──────────────────────────────────────────────────────

test("diff recovers what an edit changed, and nothing else", () => {
  const mine = structuredClone(BANDIT);
  mine.name = "Marlo's Enforcer";
  mine.system.attributes.hp.value = 45;

  assert.deepEqual(diff(BANDIT, mine), {
    name: "Marlo's Enforcer",
    system: { attributes: { hp: { value: 45 } } },
  });
});

test("an unchanged document produces no patch at all", () => {
  assert.equal(diff(BANDIT, structuredClone(BANDIT)), undefined);
});

test("a removed key comes back as null", () => {
  const mine = structuredClone(BANDIT);
  delete mine.system.details.cr;
  assert.deepEqual(diff(BANDIT, mine), { system: { details: { cr: null } } });
});

test("diffing a keyed array names only the entries that moved", () => {
  const mine = structuredClone(BANDIT);
  mine.items[1].system.damage = "2d8";
  assert.deepEqual(diff(BANDIT, mine), {
    items: [{ _id: "itemCrossbow001", system: { damage: "2d8" } }],
  });
});

test("round trip: applying a recovered diff reproduces the edit", () => {
  // The property everything else rests on.
  const mine = structuredClone(BANDIT);
  mine.name = "Marlo's Enforcer";
  mine.system.attributes.hp = { value: 45, max: 45 };
  delete mine.system.details.cr;
  mine.items[0].name = "Notched Scimitar";
  mine.items.push({ _id: "itemAmulet00001", name: "Amulet", system: {} });

  const patch = diff(BANDIT, mine);
  assert.deepEqual(applyPatch(BANDIT, patch), mine);
});

test("removing an item from a keyed array is NOT representable", () => {
  // Documented, not fixed. Merge-by-id reads an omitted entry as "leave it
  // alone", so there is nowhere to say "drop this". Expressing it means RFC
  // 6902 `remove` ops, which address members positionally and break under the
  // reordering that keying by _id exists to survive. The round trip fails
  // loudly here rather than silently shipping a patch that does nothing.
  const mine = structuredClone(BANDIT);
  mine.items = mine.items.filter((i) => i._id !== "itemCrossbow001");

  const patch = diff(BANDIT, mine);
  assert.equal(patch, undefined, "nothing changed that the format can say");
  assert.equal(applyPatch(BANDIT, patch ?? {}).items.length, 2, "so the item survives");
});
