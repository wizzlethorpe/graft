// The pre-build transforms: collected through a hook, run once each, in
// registration order. A transform gets no second pass, so anything its output
// still needs happens in `graftBuilt` instead.

import test from "node:test";
import assert from "node:assert/strict";

import { collectTransforms, runTransforms } from "../scripts/prebuild.mjs";

const spy = (id, log, transform = (e) => e) =>
  ({ id, label: id, transform: (entries) => { log.push(id); return transform(entries); } });

test("transforms run in order and pass entries along", async () => {
  const log = [];
  const { entries, skipped } = await runTransforms([
    spy("first", log, (e) => [...e, { id: "b" }]),
    spy("second", log, (e) => e.map((x) => ({ ...x, seen: true }))),
  ], [{ id: "a" }]);
  assert.deepEqual(log, ["first", "second"]);
  assert.deepEqual(entries.map((e) => e.id), ["a", "b"]);
  assert.ok(entries.every((e) => e.seen), "the second saw what the first produced");
  assert.deepEqual(skipped, []);
});

test("a transform may return an array, a report, or nothing", async () => {
  const before = [{ id: "a" }];
  const quiet = await runTransforms([{ id: "quiet", label: "quiet", transform: () => undefined }], before);
  assert.deepEqual(quiet.entries, before, "nothing means the entries pass through");

  const { entries, skipped, warnings } = await runTransforms([{
    id: "full", label: "Full",
    transform: (e) => ({ entries: e, skipped: [{ id: "x", reason: "gone" }], warnings: [{ id: "y", reason: "odd" }] }),
  }], before);
  assert.deepEqual(entries, before);
  assert.deepEqual(skipped, [{ by: "Full", id: "x", reason: "gone" }]);
  assert.deepEqual(warnings, [{ by: "Full", id: "y", reason: "odd" }]);
});

test("one transform failing does not stop the rest", async () => {
  const log = [];
  const { entries, skipped } = await runTransforms([
    { id: "broken", label: "Broken", transform: () => { throw new Error("no connection"); } },
    spy("survivor", log),
  ], [{ id: "kept" }]);
  assert.deepEqual(log, ["survivor"]);
  assert.deepEqual(entries, [{ id: "kept" }], "entries reach the next transform untouched");
  assert.deepEqual(skipped, [{ by: "Broken", id: "(transform)", reason: "no connection" }]);
});

test("the hook collects without running, and the label defaults to the id", () => {
  const handlers = [];
  globalThis.Hooks = { callAll: (_name, ...args) => handlers.forEach((h) => h(...args)) };
  try {
    let ran = false;
    handlers.push((moduleId, register) => {
      assert.equal(moduleId, "my-mod");
      register({ id: "vaults", transform: () => { ran = true; } });
    });
    const transforms = collectTransforms("my-mod");
    assert.equal(transforms.length, 1);
    assert.equal(transforms[0].label, "vaults");
    assert.equal(ran, false, "collecting must not run anything");
  } finally {
    delete globalThis.Hooks;
  }
});

test("a registration without an id or a transform is refused", () => {
  const handlers = [];
  globalThis.Hooks = { callAll: (_name, ...args) => handlers.forEach((h) => h(...args)) };
  try {
    handlers.push((_id, register) => {
      assert.throws(() => register({ transform: () => {} }), /needs an id/);
      assert.throws(() => register({ id: "x" }), /needs a transform/);
    });
    assert.deepEqual(collectTransforms("m"), []);
  } finally {
    delete globalThis.Hooks;
  }
});
