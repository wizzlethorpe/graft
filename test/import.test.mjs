// Preparing somebody else's grafts.json for packs it was never written for.
//
// The file names its own entries by the packs its author used, which say
// nothing about where an import puts them. Everything here is that translation;
// creating the packs and building needs Foundry and is not covered.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { importGrafts, localiseSources, typesIn, packStem } from "../scripts/import.mjs";

describe("building a file somebody sent you", () => {
  const saved = globalThis.game;
  afterEach(() => { globalThis.game = saved; });

  /** Enough Foundry to raise an error message. */
  const installI18n = () => {
    globalThis.game = { i18n: { localize: (key) => key, format: (key) => key } };
  };

  test("refuses a bare list, which is the old format", async () => {
    installI18n();
    await assert.rejects(() => importGrafts([{ id: "a" }], "x"), /ImportNotEntries/);
  });

  test("refuses a format written for a newer graft", async () => {
    installI18n();
    await assert.rejects(() => importGrafts({ format: 99, entries: [{ id: "a" }] }, "x"), /ImportFormat/);
  });
});

describe("localiseSources", () => {
  const file = () => ([
    { id: "aaaaaaaaaaaaaaaa", type: "Item", pack: "kit-items", patch: {} },
    {
      id: "bbbbbbbbbbbbbbbb", type: "Actor", pack: "kit-actors",
      source: "Compendium.kerra.kit-items.Item.aaaaaaaaaaaaaaaa",
      patch: {},
    },
  ]);

  test("folds a reference to the file's own entry back to a bare id", () => {
    // Which is then resolved against the packs the import creates, so the
    // author's module and pack names never have to be guessed at.
    const [, actor] = localiseSources(file());
    assert.equal(actor.source, "aaaaaaaaaaaaaaaa");
  });

  test("leaves somebody else's content alone", () => {
    const entries = localiseSources([
      { id: "bbbbbbbbbbbbbbbb", type: "Actor", pack: "kit-actors", source: "Compendium.dnd5e.actors24.Actor.mmWight000000000" },
    ]);
    assert.equal(entries[0].source, "Compendium.dnd5e.actors24.Actor.mmWight000000000");
  });

  test("an id the file defines in a different pack is not a self-reference", () => {
    const entries = localiseSources([
      { id: "aaaaaaaaaaaaaaaa", type: "Item", pack: "kit-items" },
      { id: "bbbbbbbbbbbbbbbb", type: "Actor", pack: "kit-actors", source: "Compendium.kerra.other-items.Item.aaaaaaaaaaaaaaaa" },
    ]);
    assert.equal(entries[1].source, "Compendium.kerra.other-items.Item.aaaaaaaaaaaaaaaa");
  });

  test("never folds an entry's source into its own id", () => {
    // A document imported out of a pack keeping its id records that pack as
    // where it came from. Folding that reads as "graft this onto itself", and
    // the build reported a cycle through zero other entries.
    const entries = localiseSources([{
      id: "aaaaaaaaaaaaaaaa", type: "Actor", pack: "southaven-actors",
      source: "Compendium.southaven.southaven-actors.Actor.aaaaaaaaaaaaaaaa",
    }]);
    assert.equal(entries[0].source, "Compendium.southaven.southaven-actors.Actor.aaaaaaaaaaaaaaaa");
  });

  test("reaches an item the patch inserts", () => {
    const entries = localiseSources([
      { id: "aaaaaaaaaaaaaaaa", type: "Item", pack: "kit-items" },
      {
        id: "bbbbbbbbbbbbbbbb", type: "Actor", pack: "kit-actors",
        patch: { items: [{ _id: "iiiiiiiiiiiiiiii", source: "Compendium.kerra.kit-items.Item.aaaaaaaaaaaaaaaa", patch: {} }] },
      },
    ]);
    assert.equal(entries[1].patch.items[0].source, "aaaaaaaaaaaaaaaa");
  });

  test("a list of fallbacks is translated member by member", () => {
    const entries = localiseSources([
      { id: "aaaaaaaaaaaaaaaa", type: "Item", pack: "kit-items" },
      {
        id: "bbbbbbbbbbbbbbbb", type: "Actor", pack: "kit-actors",
        source: ["Compendium.kerra.kit-items.Item.aaaaaaaaaaaaaaaa", "Compendium.dnd5e.items.Item.abcdefghijklmnop"],
      },
    ]);
    assert.deepEqual(entries[1].source, ["aaaaaaaaaaaaaaaa", "Compendium.dnd5e.items.Item.abcdefghijklmnop"]);
  });

  test("does not alter the file it was given", () => {
    const original = file();
    localiseSources(original);
    assert.equal(original[1].source, "Compendium.kerra.kit-items.Item.aaaaaaaaaaaaaaaa");
  });
});

describe("typesIn", () => {
  test("one pack per type, in a stable order", () => {
    assert.deepEqual(typesIn([{ type: "Item" }, { type: "Actor" }, { type: "Item" }]), ["Actor", "Item"]);
  });

  test("ignores an entry that says nothing", () => {
    assert.deepEqual(typesIn([{ type: "Actor" }, {}, { type: null }]), ["Actor"]);
  });
});

describe("packStem", () => {
  test("makes a pack name out of whatever it was called", () => {
    // Punctuation becomes a separator rather than vanishing, which is what the
    // vaults CLI does deriving a module id, and consistency beats prettiness.
    assert.equal(packStem("Kerra's Bestiary"), "kerra-s-bestiary");
    assert.equal(packStem("  --Odd -- Name--  "), "odd-name");
  });

  test("falls back rather than producing an empty name", () => {
    assert.equal(packStem("!!!"), "imported-grafts");
    assert.equal(packStem(""), "imported-grafts");
  });
});

describe("localiseSources, through an assembled Adventure", () => {
  test("folds a reference to the file's own entry inside its Adventure", () => {
    const entries = localiseSources([
      { id: "aaaaaaaaaaaaaaaa", type: "Actor", pack: "tryk-adventure" },
      {
        id: "bbbbbbbbbbbbbbbb", type: "Actor", pack: "tryk-adventure",
        source: "Compendium.tryk.tryk-adventure.Adventure.advid00000000001.Actor.aaaaaaaaaaaaaaaa",
      },
    ]);
    assert.equal(entries[1].source, "aaaaaaaaaaaaaaaa");
  });
});
