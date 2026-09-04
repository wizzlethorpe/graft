// Preparing somebody else's grafts.json for a world it was never written for.
//
// The file names its own entries by the packs its author used, which say
// nothing about where an import puts them. Everything here is that translation.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { importGrafts, localiseSources } from "../scripts/import.mjs";

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
    // Which is then resolved against what this import builds, so the author's
    // module and pack names never have to be guessed at.
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
