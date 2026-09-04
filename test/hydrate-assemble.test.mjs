// Building into an Adventure pack: members are never written on their own, a
// sibling resolves from the build rather than the pack, one Adventure is
// written holding them all, a member that did not build this run keeps its
// place, and an unchanged rebuild writes nothing.

import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { adventureId } from "../scripts/plan.mjs";
import { adventureFolderId } from "../scripts/assemble.mjs";

const ADV = adventureId("mod", "adv");
const inside = (id) => `Compendium.mod.adv.Adventure.${ADV}.Actor.${id}`;

const base = { id: "actorBase0000001", type: "Actor", pack: "adv", folder: "NPCs", patch: { name: "Guard", system: { hp: 10 } } };
const child = { id: "actorChild000001", type: "Actor", pack: "adv", source: "actorBase0000001", patch: { name: "Captain" } };
const loose = { id: "actorLoose000001", type: "Actor", pack: "actors", source: "actorBase0000001", patch: {} };

let packs;
let updates;
let adventureCreateThrows;
let rejected;

class FakeDoc {
  constructor(data, docs) { this.data = data; this.docs = docs; }
  toObject() { return structuredClone(this.data); }
  async update(data) { updates.push(data); this.data = data; }
  async delete() { this.docs.delete(this.data._id); }
}

function makePack(name, documentName, metadata = {}) {
  const docs = new Map();
  return {
    collection: `mod.${name}`, documentName, locked: false, folders: [], docs,
    metadata: { label: name, ...metadata },
    put: (data) => docs.set(data._id, new FakeDoc(data, docs)),
    getDocument: async (id) => docs.get(id) ?? null,
    getIndex: async () => ({ filter: (fn) => [...docs.values()].map((d) => d.toObject()).filter(fn) }),
  };
}

/** What Foundry does on create: stores it, unless the server rejects it. */
const create = (data, ctx) => {
  const pack = packs[ctx.pack];
  if (!rejected.has(data._id)) pack.put(data);
  return new FakeDoc(data, pack.docs);
};
class ActorCls extends FakeDoc {
  static documentName = "Actor";
  static async fromImport(doc) { return new FakeDoc({ ...doc, migrated: true, _id: "reassigned0000ok" }); }
  static async create(data, ctx) { return create(data, ctx); }
}
class AdventureCls extends FakeDoc {
  static documentName = "Adventure";
  static async create(data, ctx) {
    if (adventureCreateThrows) throw new Error("refused by the server");
    return create(data, ctx);
  }
}

beforeEach(() => {
  updates = [];
  adventureCreateThrows = false;
  rejected = new Set();
  packs = {
    "mod.adv": makePack("adv", "Adventure", { label: "Tryk Academy", flags: { graft: { description: "<p>A school.</p>" } } }),
    "mod.actors": makePack("actors", "Actor"),
  };
  globalThis.game = {
    packs: { get: (c) => packs[c] ?? null },
    settings: { get: () => ({}), set: async () => {} },
  };
  globalThis.getDocumentClass = (name) => ({ Actor: ActorCls, Adventure: AdventureCls })[name];
  globalThis.foundry = { utils: { setProperty(o, p, v) {
    const ks = p.split("."); let n = o;
    for (const k of ks.slice(0, -1)) n = n[k] ??= {};
    n[ks.at(-1)] = v;
  } } };
  globalThis.fromUuid = async () => null;   // nothing resolves from outside the build
  globalThis.ui = { notifications: { warn: () => {}, info: () => {} } };
});
afterEach(() => {
  for (const k of ["game", "getDocumentClass", "foundry", "fromUuid", "ui"]) delete globalThis[k];
});

async function run(entries, options = {}) {
  const { hydrate } = await import("../scripts/hydrate.mjs");
  return hydrate("mod", entries, options);
}
const adventure = () => packs["mod.adv"].docs.get(ADV)?.toObject();

describe("hydrate into an Adventure pack", () => {
  test("writes one Adventure holding every member, migrated and filed", async () => {
    const { built, skipped, warnings } = await run([child, base]);
    assert.deepEqual(skipped, []);
    assert.deepEqual(warnings, []);
    assert.deepEqual(built, [inside("actorBase0000001"), inside("actorChild000001")]);

    const adv = adventure();
    assert.ok(adv, "the Adventure was created under its deterministic id");
    assert.equal(adv.name, "Tryk Academy");
    assert.equal(adv.description, "<p>A school.</p>");
    assert.equal(adv.flags.graft.built, true);
    assert.deepEqual(adv.actors.map((a) => a._id), ["actorBase0000001", "actorChild000001"]);
    assert.equal(adv.actors[0].migrated, true, "members went through their own class");
    assert.equal(adv.actors[0].folder, adventureFolderId("mod", "adv", "Actor", ["NPCs"]));
    assert.deepEqual(adv.folders.map((f) => [f.name, f.type]), [["NPCs", "Actor"]]);
    assert.equal(packs["mod.adv"].docs.size, 1, "members are not written on their own");
  });

  test("a sibling resolves from the build, not from the pack", async () => {
    const { skipped } = await run([child, base]);
    assert.deepEqual(skipped, []);
    const captain = adventure().actors.find((a) => a.name === "Captain");
    assert.equal(captain.system.hp, 10, "inherited from the sibling that was never written anywhere");
  });

  test("a document in an ordinary pack can graft onto an assembled sibling", async () => {
    const { built, skipped } = await run([loose, base]);
    assert.deepEqual(skipped, []);
    assert.ok(built.includes("Compendium.mod.actors.Actor.actorLoose000001"));
    const doc = packs["mod.actors"].docs.get("actorLoose000001").toObject();
    assert.equal(doc.system.hp, 10);
    // Provenance points through the Adventure, which is the only address the
    // sibling will have once built.
    assert.deepEqual(doc.flags.graft.origin, { adventure: `Compendium.mod.adv.Adventure.${ADV}`, id: "actorBase0000001" });
  });

  test("an Adventure that cannot be written fails its members, by name", async () => {
    adventureCreateThrows = true;
    const { built, skipped } = await run([child, base]);
    assert.deepEqual(built, []);
    assert.deepEqual(skipped.map((s) => s.id).sort(), ["actorBase0000001", "actorChild000001"]);
    assert.match(skipped[0].reason, /Adventure could not be written.*refused/);
  });

  test("an unchanged rebuild writes nothing; a changed entry rewrites the Adventure", async () => {
    await run([child, base]);
    await run([child, base]);
    assert.equal(updates.length, 0);
    await run([{ ...child, patch: { name: "Commander" } }, base]);
    assert.equal(updates.length, 1);
    assert.ok(updates[0].actors.some((a) => a.name === "Commander"));
  });

  test("a type an Adventure has no field for is refused for that pack", async () => {
    const { skipped } = await run([{ id: "cards00000000001", type: "Fizz", pack: "adv", patch: {} }]);
    assert.match(skipped[0].reason, /nowhere to put a Fizz/);
  });

  test("a Folder is not a member: folders come from members' paths", async () => {
    const folder = { id: "folder0000000001", type: "Folder", pack: "adv", patch: { name: "NPCs", type: "Actor" } };
    const { skipped } = await run([folder, base]);
    assert.deepEqual(skipped.map((s) => s.id), ["folder0000000001"]);
    assert.deepEqual(adventure().folders.map((f) => f.name), ["NPCs"]);
  });
});

describe("a member that did not build this run", () => {
  test("keeps its place when a transform dropped it from the entries", async () => {
    await run([child, base]);
    const { skipped } = await run([base], { declared: [child, base] });
    assert.deepEqual(skipped, []);
    assert.deepEqual(adventure().actors.map((a) => a._id), ["actorBase0000001", "actorChild000001"]);
    assert.equal(updates.length, 0, "nothing moved, so nothing was written");
  });

  test("keeps its place when its source is missing this run", async () => {
    await run([child, base]);
    const gone = { ...child, source: "Compendium.gone.pack.Actor.zzzzzzzzzzzzzzzz" };
    const { skipped } = await run([gone, base]);
    assert.deepEqual(skipped.map((s) => s.id), ["actorChild000001"]);
    const captain = adventure().actors.find((a) => a._id === "actorChild000001");
    assert.equal(captain?.name, "Captain", "the previous build's copy survives");
  });

  test("survives a run that produced nothing for its pack", async () => {
    // A transform failing to reach its source drops every entry; the
    // Adventure it built last time is not stale for it.
    await run([child, base]);
    const { removed } = await run([], { declared: [child, base] });
    assert.deepEqual(removed, []);
    assert.deepEqual(adventure().actors.map((a) => a._id), ["actorBase0000001", "actorChild000001"]);
  });

  test("is dropped once it is no longer declared", async () => {
    await run([child, base]);
    await run([base]);
    assert.deepEqual(adventure().actors.map((a) => a._id), ["actorBase0000001"]);
    assert.equal(updates.length, 1);
  });
});

describe("a sibling of a document Foundry rejected", () => {
  test("is not built on the data that never landed", async () => {
    const parent = { id: "looseBase0000001", type: "Actor", pack: "actors", patch: { name: "Guard" } };
    const kid = { id: "looseChild000001", type: "Actor", pack: "actors", source: "looseBase0000001", patch: {} };
    rejected.add("looseBase0000001");
    const { built, skipped } = await run([kid, parent]);
    assert.deepEqual(built, []);
    assert.deepEqual(skipped.map((s) => s.id).sort(), ["looseBase0000001", "looseChild000001"]);
    assert.match(skipped.find((s) => s.id === "looseChild000001").reason, /did not resolve/);
  });
});

describe("pruning an Adventure pack", () => {
  test("removes what graft built there under any other id, and nothing else", async () => {
    // A format 1 file built one document per Adventure entry; the assembled
    // Adventure replaces them, and a document the reader added stays.
    packs["mod.adv"].put({ _id: "fleshMountainGr1", name: "Old", flags: { graft: { built: true } } });
    packs["mod.adv"].put({ _id: "handmade00000001", name: "Mine", flags: {} });
    const { removed } = await run([base]);
    assert.deepEqual(removed.map((r) => r.id), ["fleshMountainGr1"]);
    assert.deepEqual([...packs["mod.adv"].docs.keys()].sort(), [ADV, "handmade00000001"].sort());
  });
});
