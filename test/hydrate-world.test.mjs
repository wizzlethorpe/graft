import test, { describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";

import { installWorld, serveFiles, uninstallWorld } from "./foundry-stub.mjs";
import { filled, required } from "./fake-schema.mjs";

const base = { id: "actorBase0000001", type: "Actor", pack: "kit-actors", folder: "NPCs", patch: { name: "Guard", system: { hp: 10 } } };
const child = { id: "actorChild000001", type: "Actor", pack: "kit-actors", source: "actorBase0000001", patch: { name: "Captain" } };
const note = { id: "journal000000001", type: "JournalEntry", pack: "kit-journals", folder: "NPCs", patch: { name: "Notes" } };

let collections;
let folders;
let WorldDoc;

beforeEach(() => {
  ({ collections, folders, WorldDoc } = installWorld({ types: ["Actor", "JournalEntry"] }));
});
afterEach(uninstallWorld);

async function run(entries, options = {}) {
  const { hydrateWorld } = await import("../scripts/hydrate.mjs");
  return hydrateWorld(entries, options);
}
/** A document of the reader's own, carrying `built` but never `imported`. */
const mine = (id, name, type = "Actor") =>
  collections.get(type).set(id, new WorldDoc({ _id: id, name, flags: { graft: { built: true } } }));
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

  /** An Actor whose items are Items that need a name, each with effects that need one too. */
  function needNames() {
    const Effect = { schema: { fields: { name: required } } };
    const Item = { schema: { fields: { name: required, flags: filled } }, hierarchy: { effects: { model: Effect } } };
    const stub = globalThis.getDocumentClass;
    globalThis.getDocumentClass = (type) => Object.assign(stub(type), { hierarchy: { items: { model: Item } } });
  }
  const wight = { ...base, patch: { name: "Wight", items: [{ _id: "sword00000000001", name: "Sword", effects: [{ _id: "fx00000000000001", name: "Chill" }] }] } };
  const merchant = (items) => ({ id: "actorChild000001", type: "Actor", source: "actorBase0000001",
    patch: { name: "Merchant", items, system: { advancement: [{ _id: "adv0000000000001", level: 1 }] } } });
  const sword = { _id: "sword00000000001", flags: { hidden: true } };
  const dagger = { _id: "dagger0000000001", name: "Dagger" };

  test("skips an entry whose patch changes a member its source does not have, naming the member and the source", async () => {
    needNames();
    const broken = await run([wight, merchant([sword, { _id: "bow0000000000001", flags: { hidden: true } }, dagger])]);
    assert.equal(broken.skipped.length, 1);
    assert.match(broken.skipped[0].reason, /items bow0000000000001, which Actor\.actorBase0000001 does not have/);
    assert.equal(actor("actorChild000001"), undefined);

    const fine = await run([wight, merchant([sword, dagger])]);
    assert.deepEqual(fine.skipped, []);
    assert.deepEqual(actor("actorChild000001").items.map((i) => i._id), ["sword00000000001", "dagger0000000001"]);
    assert.deepEqual(actor("actorChild000001").system.advancement, [{ _id: "adv0000000000001", level: 1 }]);
  });

  test("names a stray change inside a matched member by the path to it", async () => {
    needNames();
    const { skipped } = await run([wight, merchant([{ _id: "sword00000000001", effects: [{ _id: "fx00000000000002", disabled: true }] }])]);
    assert.match(skipped[0].reason, /items\.effects fx00000000000002/);
  });

  test("checks a nested graft's own patch against the document it names", async () => {
    needNames();
    const nested = (patch) => merchant([{ _id: "mine000000000001", source: "actorBase0000001", patch }]);
    // The wight stands in for an item source: what matters is that it has no such effect.
    const broken = await run([wight, nested({ effects: [{ _id: "fx00000000000009", disabled: true }] })]);
    assert.match(broken.skipped[0].reason, /effects fx00000000000009, which Actor\.actorBase0000001 does not have/);
    const fine = await run([wight, nested({ name: "Mine" })]);
    assert.deepEqual(fine.skipped, []);
  });

  test("an entry with no source is not checked: the patch is the document", async () => {
    needNames();
    const { skipped } = await run([{ ...base, patch: { name: "Guard", items: [{ _id: "bow0000000000001", flags: {} }] } }]);
    assert.deepEqual(skipped, []);
  });

  test("a sibling by bare id resolves", async () => {
    const { skipped } = await run([child, base]);
    assert.deepEqual(skipped, []);
    assert.equal(actor("actorChild000001").system.hp, 10);
  });

  test("keeps a document no import wrote when the reader declines", async () => {
    // Dragged out of a graft pack with its id kept: it carries `built`, and
    // the reader may have edited it since.
    mine("actorBase0000001", "Mine");
    const { built, skipped } = await run([base], { confirmOverwrite: async () => false });
    assert.deepEqual(built, []);
    assert.match(skipped[0].reason, /Mine already has this id.*not overwritten/);
    assert.equal(actor("actorBase0000001").name, "Mine");
  });

  test("refuses one when nobody is there to ask", async () => {
    mine("actorBase0000001", "Mine");
    const { built } = await run([base]);
    assert.deepEqual(built, []);
    assert.equal(actor("actorBase0000001").name, "Mine");
  });

  test("replaces it when the reader agrees, and says which", async () => {
    mine("actorBase0000001", "Mine");
    const { built, warnings } = await run([base], { confirmOverwrite: async () => true });
    assert.deepEqual(built, ["Actor.actorBase0000001"]);
    assert.equal(actor("actorBase0000001").name, "Guard");
    assert.match(warnings.find((w) => w.id === "actorBase0000001").reason, /replaced Mine/);
  });

  test("asks once for the whole import, naming every document at stake", async () => {
    mine("actorBase0000001", "Mine");
    mine("journal000000001", "My notes", "JournalEntry");
    const asked = [];
    await run([base, note], { confirmOverwrite: async (existing) => { asked.push(existing); return true; } });
    assert.equal(asked.length, 1, `asked ${asked.length} times`);
    assert.deepEqual(asked[0].map((e) => e.name).sort(), ["Mine", "My notes"]);
  });

  test("asks nothing about a document only an entry graft will not build would have landed on", async () => {
    mine("actorBase0000001", "Mine");
    let asked = 0;
    const { skipped } = await run([{ ...base, source: ["a", "b"] }], { confirmOverwrite: async () => { asked += 1; return true; } });
    assert.equal(asked, 0);
    assert.equal(skipped.length, 1);
    assert.equal(actor("actorBase0000001").name, "Mine");
  });

  test("asks nothing when every entry lands somewhere free", async () => {
    let asked = 0;
    await run([base], { confirmOverwrite: async () => { asked += 1; return true; } });
    assert.equal(asked, 0);
  });

  test("refreshes a document an earlier import built, in the folders it made", async () => {
    await run([base]);
    const made = folders.length;
    const { skipped } = await run([{ ...base, patch: { name: "Guard, promoted" } }]);
    assert.deepEqual(skipped, []);
    assert.equal(actor("actorBase0000001").name, "Guard, promoted");
    assert.equal(folders.length, made, "folders are matched by type, name and parent, not made again");
  });

  test("rewrites an unchanged document an older Foundry wrote, and leaves one this Foundry wrote alone", async () => {
    // Rebuilding is what migrates a document to the running generation.
    await run([base]);
    const stored = collections.get("Actor").get("actorBase0000001");
    const writes = [];
    const update = stored.update.bind(stored);
    stored.update = async (data, options) => { writes.push(data); return update(data, options); };

    stored.data._stats = { coreVersion: "14.367" };
    await run([base]);
    assert.equal(writes.length, 0, "rewrote a document nothing had changed");

    stored.data._stats = { coreVersion: "13.346" };
    await run([base]);
    assert.equal(writes.length, 1, "left a document an older Foundry wrote unmigrated");
  });

  test("never builds a sibling on a document no import wrote", async () => {
    collections.get("Actor").set("actorBase0000001", new WorldDoc({ _id: "actorBase0000001", name: "Mine", flags: { graft: { built: true } }, system: { hp: 99 } }));
    const { built, skipped } = await run([child, base]);
    assert.deepEqual(built, []);
    assert.match(skipped.find((s) => s.id === "actorChild000001").reason, /did not resolve/);
    assert.equal(folders.length, 0, "nothing was written, so no folder was made");
  });

  test("makes no folder for an entry that fails to prepare", async () => {
    globalThis.getDocumentClass = () => class extends WorldDoc {
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

describe("a file source", () => {
  const serve = serveFiles;

  test("a source ending in .json is read off disk, not looked up as a uuid", async () => {
    serve({ "graft/vault/guard.json": { name: "Guard", system: { hp: 10 } } });
    const { skipped } = await run([{
      id: "actorFile0000001", type: "Actor",
      source: "graft/vault/guard.json", patch: { name: "Captain" },
    }]);
    assert.deepEqual(skipped, []);
    const built = actor("actorFile0000001");
    assert.equal(built.name, "Captain", "the patch applied over the file's contents");
    assert.equal(built.system.hp, 10, "the file supplied the base document");
  });

  test("a file a handler never placed skips that entry and says so", async () => {
    serve({});
    const { built, skipped } = await run([{
      id: "actorFile0000002", type: "Actor",
      source: "graft/vault/missing.json", patch: { name: "Nobody" },
    }]);
    assert.deepEqual(built, []);
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /is not on disk/);
  });
});

describe("resolving sources", () => {
  test("reads each source once, however many entries graft onto it", async () => {
    const reads = [];
    const base = { name: "Commoner", type: "npc", system: { hp: 4 } };
    globalThis.fromUuid = async (uuid) => {
      reads.push(uuid);
      return { toObject: () => ({ ...base }) };
    };
    const entries = ["a", "b", "c"].map((n, i) => ({
      id: `actorShared0000${i}`, type: "Actor",
      source: "Compendium.mm.actors.Actor.mmCommoner000000",
      patch: { name: `NPC ${n}` },
    }));
    const { skipped } = await run(entries);
    assert.deepEqual(skipped, []);
    assert.equal(reads.length, 1, `read the same source ${reads.length} times`);
    assert.equal(actor("actorShared00000").system.hp, 4, "the cached copy still supplied the base");
    assert.equal(actor("actorShared00002").name, "NPC c");
  });
});
