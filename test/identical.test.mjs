// Deciding whether a write would change anything, so an unchanged rebuild
// can skip it.
//
// The cost this exists for is real: a compendium write measured ~234ms against
// ~8ms to prepare the document, so on a rebuild where little moved almost all
// of the time is spent writing what is already there. Compared rather than
// remembered, so nothing can go stale.

import { describe, test } from "node:test";
import assert from "node:assert/strict";

import { identical } from "../scripts/hydrate.mjs";

const doc = (over = {}) => ({
  _id: "abcdefghijklmnop",
  name: "Bandit",
  type: "npc",
  folder: "aaaaaaaaaaaaaaaa",
  system: { attributes: { hp: { value: 11 } } },
  _stats: { coreVersion: "14.367", modifiedTime: 1, lastModifiedBy: "userA" },
  ...over,
});

describe("identical", () => {
  test("a document that would be written back unchanged", () => {
    assert.equal(identical(doc(), doc()), true);
  });

  test("ignores what Foundry rewrites on every save", () => {
    // Without this every document differs every time and nothing is ever
    // skipped, which is the failure that makes the whole thing pointless.
    const saved = doc({ _stats: { coreVersion: "14.367", modifiedTime: 999, lastModifiedBy: "userB" } });
    assert.equal(identical(doc(), saved), true);
  });

  test("notices a changed field at any depth", () => {
    assert.equal(identical(doc(), doc({ name: "Bandit Captain" })), false);
    assert.equal(identical(doc(), doc({ system: { attributes: { hp: { value: 12 } } } })), false);
  });

  test("notices a move between folders", () => {
    // stripVolatile drops `folder` because it is not part of a source diff.
    // Here it is exactly the thing a rebuild has to act on.
    assert.equal(identical(doc(), doc({ folder: "bbbbbbbbbbbbbbbb" })), false);
  });

  test("notices a Foundry version the document was migrated under", () => {
    const older = doc({ _stats: { coreVersion: "13.346", modifiedTime: 1, lastModifiedBy: "userA" } });
    assert.equal(identical(doc(), older), false);
  });

  test("notices an added or removed key", () => {
    const { system: _dropped, ...without } = doc();
    assert.equal(identical(doc(), without), false);
    assert.equal(identical(doc(), doc({ extra: 1 })), false);
  });

  test("key order is not a difference", () => {
    const reordered = { _stats: doc()._stats, system: doc().system, folder: doc().folder, type: "npc", name: "Bandit", _id: "abcdefghijklmnop" };
    assert.equal(identical(doc(), reordered), true);
  });

  test("an embedded item changing is a difference", () => {
    const withItems = (hp) => doc({ items: [{ _id: "i1", name: "Club", system: { hp } }] });
    assert.equal(identical(withItems(1), withItems(1)), true);
    assert.equal(identical(withItems(1), withItems(2)), false);
  });
});
