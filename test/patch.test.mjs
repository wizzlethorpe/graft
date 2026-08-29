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
    isWhole: () => true,
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
  const out = await referenceSources({ items: [mine] }, { sourceOf: () => null, resolve, isWhole: () => true });
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

  const referenced = await referenceSources({ items: [mine] }, { sourceOf, resolve, isWhole: () => true });
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

// ── adventures ──────────────────────────────────────────────────────────────

test("an adventure's internal folder pointers survive stripping", async () => {
  // The one place `folder` is not world-local. An Adventure carries its own
  // `folders` array and its embedded documents point into it, and that array
  // travels with the document, so those ids stay meaningful on the other side.
  // Stripping at depth would ship the folders empty and every document loose.
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const adventure = {
    _id: "advSpectacular01", name: "Spectacular Shops",
    folder: "packFolderId001",                       // world-local, goes
    folders: [
      { _id: "folderShops0001", name: "Shops", type: "Actor", folder: null },
      { _id: "folderArmory0001", name: "Weapons", type: "Actor", folder: "folderShops0001" },
    ],
    actors: [{ _id: "actorKosov000001", name: "Kosov", folder: "folderArmory0001",
               _stats: { modifiedTime: 1 }, ownership: { default: 0, someUser0000001: 3 } }],
  };
  const out = stripVolatile(adventure);

  assert.ok(!("folder" in out), "the adventure's own folder is world-local and goes");
  assert.equal(out.folders.length, 2, "the folders it carries stay");
  assert.equal(out.folders[1].folder, "folderShops0001", "including the tree between them");
  assert.equal(out.actors[0].folder, "folderArmory0001", "and what points into it");
  assert.ok(!("_stats" in out.actors[0]), "while genuine noise still goes at depth");
  assert.deepEqual(out.actors[0].ownership, { default: 0 });
});

// ── whole or partial, decided by the caller rather than guessed ─────────────

test("a document with no `type` field is still referenced", async () => {
  // Journals, scenes and roll tables have no `type`, so the old shape-based
  // guess never referenced them and shipped their text as a copy instead. An
  // adventure's payload is mostly exactly those.
  const { diff, referenceSources } = await import("../scripts/patch.mjs");
  const theirs = { _id: "jrnlShopIntro01", name: "Welcome", pages: [{ _id: "pg1", text: "licensed prose" }] };
  const before = { name: "Adventure", journal: [] };
  const mine = { name: "Adventure", journal: [{ ...theirs, name: "Welcome, traveller" }] };

  const whole = new Set();
  const delta = diff(before, mine, whole);
  assert.ok(whole.has("jrnlShopIntro01"), "diff knew there was no prior for it");

  const out = await referenceSources(delta, {
    sourceOf: (id) => (id === "jrnlShopIntro01" ? "Compendium.shops.journal.JournalEntry.x" : null),
    resolve: async () => theirs,
    isWhole: (id) => whole.has(id),
  });
  assert.equal(out.journal[0].source, "Compendium.shops.journal.JournalEntry.x");
  assert.deepEqual(out.journal[0].patch, { name: "Welcome, traveller" });
  assert.equal(JSON.stringify(out).includes("licensed prose"), false, "their text does not travel");
});

test("renaming and retyping an existing item does not gut it", async () => {
  // The false positive. `{_id, name, type}` looked like a whole document, so it
  // was diffed against the full source, which nulled out every field it did not
  // mention. An ordinary edit, not a contrived one.
  const { diff, referenceSources, applyPatch } = await import("../scripts/patch.mjs");
  const theirs = { _id: "itemScimitar0001", name: "Scimitar", type: "weapon",
                   system: { damage: "1d6", description: "licensed" } };
  const before = { items: [theirs] };
  const mine = { items: [{ ...theirs, name: "Cutlass", type: "melee" }] };

  const whole = new Set();
  const delta = diff(before, mine, whole);
  assert.equal(whole.has("itemScimitar0001"), false, "it had a prior, so it is a delta");

  const out = await referenceSources(delta, {
    sourceOf: () => "Compendium.dnd5e.items.Item.scimitar",
    resolve: async () => theirs,
    isWhole: (id) => whole.has(id),
  });
  assert.ok(!("source" in out.items[0]), "left as a delta rather than referenced");
  const rebuilt = applyPatch(before, out).items[0];
  assert.equal(rebuilt.system.damage, "1d6", "and the fields it never mentioned survive");
  assert.equal(rebuilt.system.description, "licensed");
  assert.equal(rebuilt.name, "Cutlass");
});

test("the first entry added to an empty collection is whole", async () => {
  // `isKeyedArray` needs a member to recognise a keyed array, so an empty or
  // absent one is replaced wholesale rather than merged and never reaches
  // `diffById`. Everything inside a wholesale replacement is new by definition.
  const { diff } = await import("../scripts/patch.mjs");

  const fromEmpty = new Set();
  diff({ items: [] }, { items: [{ _id: "itemFirstOne0001", name: "A" }] }, fromEmpty);
  assert.ok(fromEmpty.has("itemFirstOne0001"));

  const fromAbsent = new Set();
  diff({}, { items: [{ _id: "itemFirstOne0001", name: "A" }] }, fromAbsent);
  assert.ok(fromAbsent.has("itemFirstOne0001"));

  const nested = new Set();
  diff({}, { journal: [{ _id: "jrnlOuter000001", pages: [{ _id: "pageInner00001" }] }] }, nested);
  assert.deepEqual([...nested].sort(), ["jrnlOuter000001", "pageInner00001"], "at any depth");
});

test("our own flags do not travel, and other modules' still do", async () => {
  // `flags.graft.origin` records where this copy came from, which is exactly as
  // volatile as `_stats` and would be a lie on the other end. Somebody else's
  // flags are not ours to curate.
  const { stripVolatile } = await import("../scripts/patch.mjs");
  const out = stripVolatile({
    name: "Flesh Mountain",
    flags: {
      graft: { origin: { adventure: "Compendium.madv.adv.Adventure.x", id: "y" } },
      "scene-packer": { hash: "abc" },
      core: { sheetClass: "" },
    },
    journal: [{ _id: "jrnlInner00001", flags: { graft: { origin: {} }, other: { keep: 1 } } }],
  });
  assert.ok(!("graft" in out.flags), "ours goes");
  assert.deepEqual(out.flags["scene-packer"], { hash: "abc" }, "theirs stays");
  assert.deepEqual(out.flags.core, { sheetClass: "" });
  assert.ok(!("graft" in out.journal[0].flags), "at depth too");
  assert.deepEqual(out.journal[0].flags.other, { keep: 1 });
});

// ── reporting a validation failure ──────────────────────────────────────────

test("eighty identical validation failures read as one line", async () => {
  // A Moulinette scene authored when WALL_MOVEMENT_TYPES.NORMAL was 1 fails
  // once per wall. The reader needs the field, the reason and the count, not
  // eighty copies and an invitation to open the console.
  const { summarizeValidation } = await import("../scripts/hydrate.mjs");
  const message = [
    "[Compendium.x.y.Scene.z] validation errors: SchemaField#_validateRecursive",
    "  walls: EmbeddedCollectionField#_validateRecursive",
    ...Array.from({ length: 80 }, (_, i) =>
      `    ${i}: SchemaField#_validateRecursive\n      move: 1 is not a valid choice`),
  ].join("\n");

  assert.equal(summarizeValidation(new Error(message)),
    "walls: move: 1 is not a valid choice (×80)");
});

test("distinct failures are all kept", async () => {
  const { summarizeValidation } = await import("../scripts/hydrate.mjs");
  const message = [
    "[Compendium.x.y.Playlist.z] validation errors: SchemaField#_validateRecursive",
    "  sounds: EmbeddedCollectionField#_validateRecursive",
    "    0: SchemaField#_validateRecursive",
    "      _id: must be a valid 16-character alphanumeric ID",
    "    1: SchemaField#_validateRecursive",
    "      path: may not be undefined",
  ].join("\n");
  const out = summarizeValidation(new Error(message));
  assert.match(out, /_id: must be a valid 16-character/);
  assert.match(out, /path: may not be undefined/);
});

test("an unrecognised error is passed through rather than lost", async () => {
  const { summarizeValidation } = await import("../scripts/hydrate.mjs");
  assert.equal(summarizeValidation(new Error("something else entirely")), "something else entirely");
});
