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

// ── noise ───────────────────────────────────────────────────────────────────

test("timestamps on embedded items do not count as changes", async () => {
  // The first real export produced this: two items whose only delta was their
  // own `_stats`, reported as edits. Stripping only the top level is not
  // enough, because every embedded document carries one.
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const stats = (t) => ({ coreVersion: "14.367", createdTime: t, modifiedTime: t,
                          lastModifiedBy: "K5n12UWOfcmnnwjH" });
  const source = { name: "Animated Armor", _stats: stats(1), items: [
    { _id: "mmSlam0000000000", name: "Slam", _stats: stats(1) },
  ] };
  const mine = { name: "Animated Armor", _stats: stats(2), items: [
    { _id: "mmSlam0000000000", name: "Slam", _stats: stats(2) },
  ] };

  assert.equal(diff(stripVolatile(source), stripVolatile(mine)), undefined,
    "nothing about the document changed");
});

test("a user id never reaches the patch, but the default does", async () => {
  // Half of `ownership` is world-local and half is not. The per-user entries
  // are ids from one world; `default` is the only way to say "players can see
  // this", which is an authorial decision worth carrying.
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const mine = stripVolatile({
    name: "Marlo's Handout",
    ownership: { default: 2, K5n12UWOfcmnnwjH: 3 },
    items: [{ _id: "itemAmulet00001", ownership: { K5n12UWOfcmnnwjH: 3 } }],
  });
  assert.deepEqual(mine.ownership, { default: 2 }, "the portable half survives");
  assert.ok(!("ownership" in mine.items[0]), "and a purely per-user map goes entirely");
  assert.equal(JSON.stringify(mine).includes("K5n12UWOfcmnnwjH"), false);
});

test("making something player-visible is a change the diff reports", async () => {
  // The point of keeping `default`: a GM-only source and a player-visible copy
  // differ in a way the reader should receive.
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const before = stripVolatile({ name: "Handout", ownership: { default: 0 } });
  const mine = stripVolatile({ name: "Handout", ownership: { default: 2, abc: 3 } });
  assert.deepEqual(diff(before, mine), { ownership: { default: 2 } });
});

test("a real edit still survives the stripping", async () => {
  // The stripping must not be so keen that it eats the change itself.
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const source = { name: "Animated Armor", _stats: { createdTime: 1 }, folder: "abc", items: [] };
  const mine = { name: "Rusted Armor", _stats: { createdTime: 2 }, folder: "xyz", items: [] };
  assert.deepEqual(diff(stripVolatile(source), stripVolatile(mine)), { name: "Rusted Armor" });
});

// ── nested grafts ───────────────────────────────────────────────────────────
//
// The premise of the whole format is that the artifact carries pointers, not
// content. Adding a magic item to a statblock broke it: the item's entire
// body, description and licence and all, went into the patch. These are the
// tests that it does not.

const AMULET = {
  _id: "srcAmulet000001",
  name: "Amulet of Health",
  type: "equipment",
  system: {
    description: { value: "<p>Your Constitution is 19 while you wear this amulet.</p>" },
    price: { value: 4000, denomination: "gp" },
    equipped: false,
  },
};
const resolve = async (uuid) =>
  uuid === "Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt" ? structuredClone(AMULET) : null;

test("an added item becomes a pointer, not a copy of its text", async () => {
  const { referenceSources } = await import("../scripts/patch.mjs");
  const mine = { _id: "IP7kWWdq5km8SZad", ...structuredClone(AMULET) };
  mine._id = "IP7kWWdq5km8SZad";
  mine.system.equipped = true;

  const out = await referenceSources({ items: [mine] }, {
    sourceOf: (id) => id === "IP7kWWdq5km8SZad" ? "Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt" : null,
    resolve,
  });

  const entry = out.items[0];
  assert.equal(entry.source, "Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt");
  assert.deepEqual(entry.patch, { system: { equipped: true } }, "only what differs");
  assert.equal(JSON.stringify(entry).includes("Constitution is 19"), false,
    "the licensed description is not in the artifact");
});

test("an item the author wrote themselves is shipped whole", async () => {
  // Content with no recorded source is theirs, and referencing it would point
  // at nothing.
  const { referenceSources } = await import("../scripts/patch.mjs");
  const mine = { _id: "myOwnItem000001", name: "Marlo's Signet", type: "equipment", system: {} };
  const out = await referenceSources({ items: [mine] }, { sourceOf: () => null, resolve });
  assert.deepEqual(out.items[0], mine);
});

test("expanding a pointer rebuilds the item on the reader's machine", async () => {
  const { expandSources, applyPatch } = await import("../scripts/patch.mjs");
  const expanded = await expandSources({
    items: [{
      _id: "IP7kWWdq5km8SZad",
      source: "Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt",
      patch: { system: { equipped: true } },
    }],
  }, resolve);

  const item = expanded.items[0];
  assert.equal(item._id, "IP7kWWdq5km8SZad", "our id, not the source's");
  assert.equal(item.name, "Amulet of Health");
  assert.equal(item.system.equipped, true, "the patch applied");
  assert.equal(item.system.price.value, 4000, "and the rest came from the source");
  // And it still merges into an actor the ordinary way.
  const actor = applyPatch({ name: "Animated Armor", items: [] }, expanded);
  assert.equal(actor.items.length, 1);
});

test("a nested source that does not resolve refuses loudly", async () => {
  // A statblock quietly missing the magic item it was built around is worse
  // than one that will not build and names the dependency.
  const { expandSources } = await import("../scripts/patch.mjs");
  await assert.rejects(
    () => expandSources({ items: [{ _id: "x", source: "Compendium.gone.pack.Item.nope" }] }, resolve),
    /Compendium\.gone\.pack\.Item\.nope did not resolve/,
  );
});

test("round trip through a reference reproduces the item", async () => {
  const { referenceSources, expandSources } = await import("../scripts/patch.mjs");
  const mine = structuredClone(AMULET);
  mine._id = "IP7kWWdq5km8SZad";
  mine.system.equipped = true;
  const sourceOf = () => "Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt";

  const referenced = await referenceSources({ items: [mine] }, { sourceOf, resolve });
  const expanded = await expandSources(referenced, resolve);
  assert.deepEqual(expanded.items[0], mine);
});

test("a class instance is opaque, not something to walk into", async () => {
  // The bug that took the longest to find. `fromUuid` returns a live Document,
  // whose embedded collections hold a `model` back-reference to the document
  // that owns them: Actor to items to model to Actor. Treating "any object" as
  // walkable meant recursing that forever. Callers must pass toObject() output,
  // and a caller who forgets now gets a wrong answer at once rather than a
  // stack overflow seconds later.
  const { stripVolatile } = await import("../scripts/patch.mjs");

  class FakeCollection { constructor(model) { this.model = model; } }
  const doc = { name: "Animated Armor", _stats: { createdTime: 1 } };
  doc.items = new FakeCollection(doc);          // the cycle, exactly as Foundry has it

  const out = stripVolatile(doc);               // must terminate
  assert.equal(out.name, "Animated Armor");
  assert.ok(!("_stats" in out));
  assert.equal(out.items, doc.items, "an instance is copied by reference, not descended into");
});

test("plain data is still walked as before", async () => {
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const out = stripVolatile({ a: { b: { _stats: {}, c: 1 } }, d: [{ _stats: {}, e: 2 }] });
  assert.deepEqual(out, { a: { b: { c: 1 } }, d: [{ e: 2 }] });
});

test("another module's flags are left exactly as they are", async () => {
  // Not ours to curate. A flag is inert on apply if the reader lacks the
  // module and possibly wanted if they have it, so neither reason the other
  // volatile fields are stripped applies to it.
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const flags = {
    "scene-packer": { hash: "65b94baa", sourceId: "Item.rdrUP2ttcvvzwYfj" },
    dnd5e: { riders: { activity: [] } },
  };
  const out = stripVolatile({ name: "War Pick", _stats: { createdTime: 1 }, flags });
  assert.deepEqual(out.flags, flags);
  assert.ok(!("_stats" in out), "the three that earn it still go");
});

// ── folders ─────────────────────────────────────────────────────────────────

test("a folder travels as a path of names, not an id", async () => {
  // An id names a folder in one world or pack and resolves to nothing
  // elsewhere, which is why `folder` is stripped from a patch. The shape an
  // author organised their work into is still worth keeping, and a path can be
  // rebuilt on the other side.
  const { folderPath } = await import("../scripts/patch.mjs");
  const bags = { name: "Bags", folder: { name: "Magic Items", folder: null } };
  assert.equal(folderPath({ folder: bags }), "Magic Items/Bags");
  assert.equal(folderPath({ folder: { name: "Tables", folder: null } }), "Tables");
  assert.equal(folderPath({ folder: null }), undefined, "not in a folder says so");
  assert.equal(folderPath(undefined), undefined);
});

test("a folder path tolerates what people type", async () => {
  const { folderSegments } = await import("../scripts/patch.mjs");
  assert.deepEqual(folderSegments("/Magic Items//Bags/ "), ["Magic Items", "Bags"]);
  assert.deepEqual(folderSegments(""), []);
  assert.deepEqual(folderSegments(undefined), []);
});

test("the id form is still stripped from a patch", async () => {
  // Both things are true at once: the path is carried on the entry, and the
  // raw id never reaches the patch.
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const out = stripVolatile({ name: "Random Magic Items", folder: "U4xmShLy19Ry54zl" });
  assert.ok(!("folder" in out));
});
