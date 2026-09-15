// Deciding whether a write would change anything, so an unchanged rebuild
// can skip it, and naming what changed when it would.
//
// The cost this exists for is real: a compendium write measured ~234ms against
// ~8ms to prepare the document, so on a rebuild where little moved almost all
// of the time is spent writing what is already there. Compared rather than
// remembered, so nothing can go stale.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { differs, outdated } from "../scripts/hydrate.mjs";

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

describe("differs", () => {
  test("a document that would be written back unchanged", () => {
    assert.equal(differs(doc(), doc()), false);
  });

  test("ignores what Foundry rewrites on every save", () => {
    // Without this every document differs every time and nothing is ever
    // skipped, which is the failure that makes the whole thing pointless.
    const saved = doc({ _stats: { coreVersion: "14.367", modifiedTime: 999, lastModifiedBy: "userB" } });
    assert.equal(differs(doc(), saved), false);
  });

  test("ignores the createdTime every build stamps afresh", () => {
    // fromImport stamps one on every build, so comparing it leaves no document
    // ever unchanged and every import rewrites all of them.
    const rebuilt = doc({ _stats: { coreVersion: "14.367", createdTime: 222, modifiedTime: 1, lastModifiedBy: "userA" } });
    const stored = doc({ _stats: { coreVersion: "14.367", createdTime: 111, modifiedTime: 1, lastModifiedBy: "userA" } });
    assert.equal(differs(rebuilt, stored), false);
  });

  test("ignores what Foundry stamps on an embedded document too", () => {
    // Every page and item carries its own _stats; filtering only the root
    // leaves the same failure one level down.
    const page = (created) => doc({
      pages: [{ _id: "p1", name: "A", _stats: { coreVersion: "14.367", createdTime: created, modifiedTime: created } }],
    });
    assert.equal(differs(page(222), page(111)), false);
  });

  test("still notices a real change beside a stamp it ignores", () => {
    const a = doc({ pages: [{ _id: "p1", name: "A", _stats: { createdTime: 1 } }] });
    const b = doc({ pages: [{ _id: "p1", name: "B", _stats: { createdTime: 2 } }] });
    assert.equal(differs(a, b), true);
  });

  test("a field named like a stamp outside _stats is still a difference", () => {
    // The filter is about `_stats`, not about the names in it.
    assert.equal(differs(doc({ system: { createdTime: 1 } }), doc({ system: { createdTime: 2 } })), true);
  });

  test("notices a changed field at any depth", () => {
    assert.equal(differs(doc(), doc({ name: "Bandit Captain" })), true);
    assert.equal(differs(doc(), doc({ system: { attributes: { hp: { value: 12 } } } })), true);
  });

  test("notices a move between folders", () => {
    // stripVolatile drops `folder` because it is not part of a source diff.
    // Here it is exactly the thing a rebuild has to act on.
    assert.equal(differs(doc(), doc({ folder: "bbbbbbbbbbbbbbbb" })), true);
  });

  test("a version Foundry writes is not a difference", () => {
    // A sourced document carries the pack's versions, and Foundry writes its
    // own. Comparing them rewrote every sourced document on every build.
    const fromPack = doc({ _stats: { coreVersion: "13.346", systemVersion: "4.1.0" } });
    const stored = doc({ _stats: { coreVersion: "14.367", systemVersion: "5.3.3" } });
    assert.equal(differs(fromPack, stored), false);
  });

  test("the source graft records is compared, unlike the rest of _stats", () => {
    // It is the one key in there graft writes, so it is the one that can
    // change because the build changed.
    const from = (uuid) => doc({ _stats: { compendiumSource: uuid } });
    assert.equal(differs(from("Compendium.a.b.Actor.x"), from("Compendium.a.b.Actor.y")), true);
  });

  test("an empty object is not a difference", () => {
    // dnd5e declares `flags.dnd5e` in its schema, so Foundry stores `{}` on a
    // document no patch ever mentioned it in.
    assert.equal(differs(doc(), doc({ flags: { dnd5e: {} } })), false);
    assert.equal(differs(doc(), doc({ flags: { dnd5e: { x: 1 } } })), true);
  });

  test("HTML Foundry sanitises on write is not a difference", () => {
    // Foundry cleans HTML fields server-side, so what comes back is never the
    // string that was sent.
    const page = (html) => doc({ pages: [{ _id: "p1", text: { content: html } }] });
    assert.equal(differs(page('<p hidden=""><a data-link="">x</a></p>'), page("<p><a data-link>x</a></p>")), false);
    assert.equal(differs(page("<p>x</p>"), page("<p>y</p>")), true);
  });

  test("notices an added or removed key", () => {
    const { system: _dropped, ...without } = doc();
    assert.equal(differs(doc(), without), true);
    assert.equal(differs(doc(), doc({ extra: 1 })), true);
  });

  test("key order is not a difference", () => {
    const reordered = { _stats: doc()._stats, system: doc().system, folder: doc().folder, type: "npc", name: "Bandit", _id: "abcdefghijklmnop" };
    assert.equal(differs(doc(), reordered), false);
  });

  test("an embedded item changing is a difference", () => {
    const withItems = (hp) => doc({ items: [{ _id: "i1", name: "Club", system: { hp } }] });
    assert.equal(differs(withItems(1), withItems(1)), false);
    assert.equal(differs(withItems(1), withItems(2)), true);
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
