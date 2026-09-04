// Building pasted grafts into the world: entries file by their own folder
// paths, a sibling resolves, and a document no import wrote is never
// overwritten or built on.

import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

const base = { id: "actorBase0000001", type: "Actor", pack: "kit-actors", folder: "NPCs", patch: { name: "Guard", system: { hp: 10 } } };
const child = { id: "actorChild000001", type: "Actor", pack: "kit-actors", source: "actorBase0000001", patch: { name: "Captain" } };
const note = { id: "journal000000001", type: "JournalEntry", pack: "kit-journals", folder: "NPCs", patch: { name: "Notes" } };

let collections;
let folders;

class FakeDoc {
  constructor(data) { this.data = data; }
  get name() { return this.data.name; }
  get flags() { return this.data.flags; }
  toObject() { return structuredClone(this.data); }
  async update(data) { this.data = data; }
}
class ActorCls extends FakeDoc {
  static documentName = "Actor";
  static async fromImport(doc) { return new FakeDoc({ ...doc, _id: "reassigned0000ok" }); }
  static async create(data) { collections.get("Actor").set(data._id, new FakeDoc(data)); }
}
class JournalCls extends ActorCls {
  static documentName = "JournalEntry";
  static async create(data) { collections.get("JournalEntry").set(data._id, new FakeDoc(data)); }
}

beforeEach(() => {
  collections = new Map([["Actor", new Map()], ["JournalEntry", new Map()]]);
  folders = [];
  globalThis.game = { collections, folders };
  globalThis.Folder = {
    create: async ({ name, type, folder }) => {
      const made = { id: `f${folders.length}`.padEnd(16, "0"), name, type, folder: folder ? { id: folder } : null };
      folders.push(made);
      return made;
    },
  };
  globalThis.getDocumentClass = (name) => ({ Actor: ActorCls, JournalEntry: JournalCls })[name];
  globalThis.foundry = { utils: { setProperty(o, p, v) {
    const ks = p.split("."); let n = o;
    for (const k of ks.slice(0, -1)) n = n[k] ??= {};
    n[ks.at(-1)] = v;
  } } };
  // World uuids resolve, as they do in Foundry; nothing outside the world does.
  globalThis.fromUuid = async (uuid) => {
    const [type, id] = uuid.split(".");
    return collections.get(type)?.get(id) ?? null;
  };
});
afterEach(() => {
  for (const k of ["game", "Folder", "getDocumentClass", "foundry", "fromUuid"]) delete globalThis[k];
});

async function run(entries) {
  const { hydrateWorld } = await import("../scripts/hydrate.mjs");
  return hydrateWorld(entries, {});
}
const actor = (id) => collections.get("Actor").get(id)?.toObject();
const folderNamed = (type, name) => folders.find((f) => f.type === type && f.name === name);

describe("hydrateWorld", () => {
  test("builds into the world, filed by each entry's folder path", async () => {
    const { built, skipped } = await run([base, note]);
    assert.deepEqual(skipped, []);
    assert.deepEqual(built, ["Actor.actorBase0000001", "JournalEntry.journal000000001"]);

    const npcs = folderNamed("Actor", "NPCs");
    assert.equal(npcs.folder, null);
    assert.equal(actor("actorBase0000001").folder, npcs.id);
    const journalNpcs = folderNamed("JournalEntry", "NPCs");
    assert.notEqual(journalNpcs.id, npcs.id, "one folder per type, as Foundry files them");
    assert.equal(collections.get("JournalEntry").get("journal000000001").toObject().folder, journalNpcs.id);
    assert.equal(actor("actorBase0000001").flags.graft.imported, true);
  });

  test("a sibling by bare id resolves", async () => {
    const { skipped } = await run([child, base]);
    assert.deepEqual(skipped, []);
    assert.equal(actor("actorChild000001").system.hp, 10);
  });

  test("never overwrites a document no import wrote", async () => {
    // Dragged out of a graft pack with its id kept: it carries `built`, and
    // the reader may have edited it since.
    collections.get("Actor").set("actorBase0000001", new FakeDoc({ _id: "actorBase0000001", name: "Mine", flags: { graft: { built: true } } }));
    const { built, skipped } = await run([base]);
    assert.deepEqual(built, []);
    assert.match(skipped[0].reason, /Mine already has this id.*not overwritten/);
    assert.equal(actor("actorBase0000001").name, "Mine");
  });

  test("refreshes a document an earlier import built, in the folders it made", async () => {
    await run([base]);
    const made = folders.length;
    const { skipped } = await run([{ ...base, patch: { name: "Guard, promoted" } }]);
    assert.deepEqual(skipped, []);
    assert.equal(actor("actorBase0000001").name, "Guard, promoted");
    assert.equal(folders.length, made, "folders are matched by type, name and parent, not made again");
  });

  test("never builds a sibling on a document no import wrote", async () => {
    collections.get("Actor").set("actorBase0000001", new FakeDoc({ _id: "actorBase0000001", name: "Mine", flags: { graft: { built: true } }, system: { hp: 99 } }));
    const { built, skipped } = await run([child, base]);
    assert.deepEqual(built, []);
    assert.match(skipped.find((s) => s.id === "actorChild000001").reason, /did not resolve/);
    assert.equal(folders.length, 0, "nothing was written, so no folder was made");
  });

  test("makes no folder for an entry that fails to prepare", async () => {
    globalThis.getDocumentClass = () => class extends FakeDoc {
      static async fromImport() { throw new Error("cannot import"); }
      constructor() { super({}); throw new Error("cannot construct"); }
    };
    const { skipped } = await run([base]);
    assert.equal(skipped.length, 1);
    assert.equal(folders.length, 0);
  });

  test("refuses a type the world cannot hold", async () => {
    const { skipped } = await run([{ id: "fizz000000000001", type: "Fizz", pack: "p", patch: {} }]);
    assert.match(skipped[0].reason, /not a document type a world holds/);
  });
});
