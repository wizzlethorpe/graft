// The build progress bar.
//
// The property under test: the bar never reads 100% while anything is still
// running. Callers announce an item before working on it, so the item just
// stepped to counts as half done; only a phase with nothing left could paint
// full, and a phase change or end() replaces the bar before that shows.

import test, { describe, beforeEach } from "node:test";
import assert from "node:assert/strict";

import { begin, phase, step, note, end } from "../scripts/progress.mjs";

let updates;

beforeEach(() => {
  updates = [];
  globalThis.ui = {
    notifications: {
      info: () => ({ update: (u) => updates.push(u) }),
      remove: () => {},
    },
  };
  begin("Graft: Test");
});

describe("progress", () => {
  test("an in-progress item counts as half", () => {
    phase("Building", 2);
    step("first");
    assert.equal(updates.at(-1).pct, 0.25);
    step("second");
    assert.equal(updates.at(-1).pct, 0.75);
  });

  test("never paints 100% while an item is on screen", () => {
    phase("Building", 1);
    step("the only, slow one");
    assert.ok(updates.at(-1).pct < 1, String(updates.at(-1).pct));
    assert.match(updates.at(-1).message, /1\/1/);
    end();
  });

  test("a phase starts at zero, not below it", () => {
    phase("Downloading", 5);
    assert.equal(updates.at(-1).pct, 0);
  });

  test("note repaints without advancing", () => {
    phase("Building", 2);
    step("one");
    const before = updates.at(-1).pct;
    note("still one, deeper in");
    assert.equal(updates.at(-1).pct, before);
    assert.match(updates.at(-1).message, /deeper/);
  });
});
