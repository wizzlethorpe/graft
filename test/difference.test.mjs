// Deciding whether a write would change anything, so an unchanged rebuild
// can skip it, and naming what changed when it would.
//
// The cost this exists for is real: a compendium write measured ~234ms against
// ~8ms to prepare the document, so on a rebuild where little moved almost all
// of the time is spent writing what is already there. Compared rather than
// remembered, so nothing can go stale.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { difference, outdated } from "../scripts/hydrate.mjs";

// Stands in for Foundry's cleaner, which serialises through the DOM: a bare
// attribute comes back with an empty value.
globalThis.foundry = {
  utils: { cleanHTML: (html) => html.replace(/ ([a-zA-Z][a-zA-Z0-9-]*)(?=[ >])/g, ' $1=""') },
};

const doc = (over = {}) => ({
  _id: "abcdefghijklmnop",
  name: "Bandit",
  type: "npc",
  folder: "aaaaaaaaaaaaaaaa",
  system: { attributes: { hp: { value: 11 } } },
  _stats: { coreVersion: "14.367", modifiedTime: 1, lastModifiedBy: "userA" },
  ...over,
});

describe("difference", () => {
  test("a document that would be written back unchanged", () => {
    assert.equal(difference(doc(), doc()), null);
  });

  test("ignores what Foundry rewrites on every save", () => {
    // Without this every document differs every time and nothing is ever
    // skipped, which is the failure that makes the whole thing pointless.
    const saved = doc({ _stats: { coreVersion: "14.367", modifiedTime: 999, lastModifiedBy: "userB" } });
    assert.equal(difference(doc(), saved), null);
  });

  test("ignores the createdTime every build stamps afresh", () => {
    // fromImport stamps one on every build, so comparing it leaves no document
    // ever unchanged and every import rewrites all of them.
    const rebuilt = doc({ _stats: { coreVersion: "14.367", createdTime: 222, modifiedTime: 1, lastModifiedBy: "userA" } });
    const stored = doc({ _stats: { coreVersion: "14.367", createdTime: 111, modifiedTime: 1, lastModifiedBy: "userA" } });
    assert.equal(difference(rebuilt, stored), null);
  });

  test("ignores what Foundry stamps on an embedded document too", () => {
    // Every page and item carries its own _stats; filtering only the root
    // leaves the same failure one level down.
    const page = (created) => doc({
      pages: [{ _id: "p1", name: "A", _stats: { coreVersion: "14.367", createdTime: created, modifiedTime: created } }],
    });
    assert.equal(difference(page(222), page(111)), null);
  });

  test("still notices a real change beside a stamp it ignores", () => {
    const a = doc({ pages: [{ _id: "p1", name: "A", _stats: { createdTime: 1 } }] });
    const b = doc({ pages: [{ _id: "p1", name: "B", _stats: { createdTime: 2 } }] });
    assert.notEqual(difference(a, b), null);
  });

  test("a field named like a stamp outside _stats is still a difference", () => {
    // The filter is about `_stats`, not about the names in it.
    assert.notEqual(difference(doc({ system: { createdTime: 1 } }), doc({ system: { createdTime: 2 } })), null);
  });

  test("notices a changed field at any depth", () => {
    assert.notEqual(difference(doc(), doc({ name: "Bandit Captain" })), null);
    assert.notEqual(difference(doc(), doc({ system: { attributes: { hp: { value: 12 } } } })), null);
  });

  test("notices a move between folders", () => {
    // stripVolatile drops `folder` because it is not part of a source diff.
    // Here it is exactly the thing a rebuild has to act on.
    assert.notEqual(difference(doc(), doc({ folder: "bbbbbbbbbbbbbbbb" })), null);
  });

  test("a version Foundry writes is not a difference", () => {
    // A sourced document carries the pack's versions, and Foundry writes its
    // own. Comparing them rewrote every sourced document on every build.
    const fromPack = doc({ _stats: { coreVersion: "13.346", systemVersion: "4.1.0" } });
    const stored = doc({ _stats: { coreVersion: "14.367", systemVersion: "5.3.3" } });
    assert.equal(difference(fromPack, stored), null);
  });

  test("the source graft records is compared, unlike the rest of _stats", () => {
    // It is the one key in there graft writes, so it is the one that can
    // change because the build changed.
    const from = (uuid) => doc({ _stats: { compendiumSource: uuid } });
    assert.notEqual(difference(from("Compendium.a.b.Actor.x"), from("Compendium.a.b.Actor.y")), null);
  });

  test("an empty object is not a difference", () => {
    // dnd5e declares `flags.dnd5e` in its schema, so Foundry stores `{}` on a
    // document no patch ever mentioned it in.
    assert.equal(difference(doc(), doc({ flags: { dnd5e: {} } })), null);
    assert.notEqual(difference(doc(), doc({ flags: { dnd5e: { x: 1 } } })), null);
  });

  test("HTML Foundry sanitises on write is not a difference", () => {
    // Foundry cleans HTML fields server-side, so what comes back is never the
    // string that was sent.
    const page = (html) => doc({ pages: [{ _id: "p1", text: { content: html } }] });
    assert.equal(difference(page('<p hidden=""><a data-link="">x</a></p>'), page("<p><a data-link>x</a></p>")), null);
    assert.notEqual(difference(page("<p>x</p>"), page("<p>y</p>")), null);
  });

  test("notices an added or removed key", () => {
    const { system: _dropped, ...without } = doc();
    assert.notEqual(difference(doc(), without), null);
    assert.notEqual(difference(doc(), doc({ extra: 1 })), null);
  });

  test("key order is not a difference", () => {
    const reordered = { _stats: doc()._stats, system: doc().system, folder: doc().folder, type: "npc", name: "Bandit", _id: "abcdefghijklmnop" };
    assert.equal(difference(doc(), reordered), null);
  });

  test("an embedded item changing is a difference", () => {
    const withItems = (hp) => doc({ items: [{ _id: "i1", name: "Club", system: { hp } }] });
    assert.equal(difference(withItems(1), withItems(1)), null);
    assert.notEqual(difference(withItems(1), withItems(2)), null);
  });
});

describe("outdated", () => {
  test("a document this Foundry wrote is not", () => {
    assert.equal(outdated(doc(), 14), false);
  });

  test("one an older Foundry wrote is, so rebuilding it migrates it", () => {
    assert.equal(outdated(doc({ _stats: { coreVersion: "13.346" } }), 14), true);
  });

  test("one with no recorded version is not, so it is not rewritten forever", () => {
    assert.equal(outdated(doc({ _stats: {} }), 14), false);
  });
});

describe("firstDifference", () => {
  test("says nothing when the two settle the same", () => {
    assert.equal(difference(doc(), doc()), null);
    assert.equal(difference(doc(), doc({ _stats: { coreVersion: "14.367", createdTime: 9 } })), null);
  });

  test("names the path, not just that something moved", () => {
    assert.equal(difference(doc(), doc({ name: "Captain" })), ".name");
    assert.equal(difference(doc(), doc({ system: { attributes: { hp: { value: 12 } } } })),
      ".system.attributes.hp.value");
  });

  test("names a key only one side has, and which side", () => {
    assert.match(difference(doc(), doc({ extra: 1 })), /\.extra .*only in the stored/);
    assert.match(difference(doc({ extra: 1 }), doc()), /\.extra .*only in the built/);
  });

  test("reaches into an embedded document", () => {
    const withPage = (name) => doc({ pages: [{ _id: "p1", name }] });
    assert.equal(difference(withPage("A"), withPage("B")), ".pages[0].name");
  });

  test("says when a collection changed length", () => {
    assert.equal(difference(doc({ pages: [] }), doc({ pages: [{ _id: "p1" }] })), ".pages.length");
  });
});
