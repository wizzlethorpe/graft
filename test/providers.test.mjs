// The provider queue.
//
// Providers rewrite entries before anything is built. The queue exists so that
// a provider emitting syntax another provider handles can say so, and the
// ordering questions that creates are the whole of what is tested here.

import test from "node:test";
import assert from "node:assert/strict";

import { runProviders } from "../scripts/providers.mjs";

/** A provider that records the order it ran in. */
const spy = (id, log, hydrate = (e) => e) =>
  ({ id, label: id, hydrate: (entries) => { log.push(id); return hydrate(entries); } });

test("providers run in order and pass entries along", async () => {
  const log = [];
  const { entries, skipped } = await runProviders([{ id: "a" }], [
    spy("first", log, (e) => [...e, { id: "b" }]),
    spy("second", log, (e) => e.map((x) => ({ ...x, seen: true }))),
  ]);
  assert.deepEqual(log, ["first", "second"]);
  assert.deepEqual(entries.map((e) => e.id), ["a", "b"]);
  assert.ok(entries.every((e) => e.seen), "the second saw what the first produced");
  assert.deepEqual(skipped, []);
});

test("a provider can enqueue another to run after it", async () => {
  // The motivating case: something emits @moulinette references, and only it
  // knows that it did.
  const log = [];
  const { entries } = await runProviders([], [
    { id: "moulinette", label: "Moulinette",
      hydrate: (e) => { log.push("moulinette"); return e.filter((x) => !x.pending); } },
    { id: "emitter", hydrate: (e) => { log.push("emitter"); return { entries: [...e, { id: "x", pending: true }], enqueue: ["moulinette"] }; } },
  ]);
  assert.deepEqual(log, ["moulinette", "emitter", "moulinette"],
    "it re-runs for input that did not exist when it first ran");
  assert.deepEqual(entries, []);
});

test("the queue deduplicates by what is pending, not by what has run", async () => {
  // The distinction that matters. Deduplicating against history would stop the
  // re-run above, which is the only reason the queue exists.
  const log = [];
  await runProviders([], [
    { id: "target", hydrate: () => { log.push("target"); } },
    { id: "one", hydrate: () => ({ enqueue: ["target"] }) },
    { id: "two", hydrate: () => ({ enqueue: ["target"] }) },
  ]);
  // one and two both ask while target is already queued by one, so it runs
  // twice overall: once up front, once for the pair.
  assert.equal(log.length, 2, "queued twice at once collapses to one run");
});

test("a provider cannot enqueue itself", async () => {
  const log = [];
  const { skipped } = await runProviders([], [
    { id: "loop", hydrate: () => { log.push("loop"); return { enqueue: ["loop"] }; } },
  ]);
  assert.equal(log.length, 1);
  assert.match(skipped[0].reason, /enqueue itself/);
});

test("mutual recursion is stopped, and the culprit is named", async () => {
  // The set stops accidental duplicates; only the cap stops two providers
  // legally taking turns forever.
  const { skipped } = await runProviders([], [
    { id: "ping", hydrate: () => ({ enqueue: ["pong"] }) },
    { id: "pong", hydrate: () => ({ enqueue: ["ping"] }) },
  ], { maxRuns: 5 });
  const halted = skipped.filter((s) => /without settling/.test(s.reason));
  assert.ok(halted.length > 0);
  assert.ok(["ping", "pong"].includes(halted[0].provider), "says which one, not just that one looped");
});

test("one provider throwing does not lose the others or the entries", async () => {
  const { entries, skipped } = await runProviders([{ id: "kept" }], [
    { id: "broken", hydrate: () => { throw new Error("Moulinette is unreachable"); } },
    { id: "fine", hydrate: (e) => [...e, { id: "added" }] },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ["kept", "added"]);
  assert.equal(skipped[0].provider, "broken");
  assert.match(skipped[0].reason, /unreachable/);
});

test("a provider reports per-entry failures without losing the build", async () => {
  // Build as much as possible, collect the rest, and let it reach the same
  // report the reader already reads.
  const { entries, skipped } = await runProviders([{ id: "a" }, { id: "b" }], [
    { id: "moulinette", label: "Moulinette", hydrate: (e) => ({
      entries: e.filter((x) => x.id !== "b"),
      skipped: [{ id: "b", reason: "your account does not include Cathedral Pack" }],
    }) },
  ]);
  assert.deepEqual(entries.map((e) => e.id), ["a"]);
  assert.deepEqual(skipped, [{ provider: "moulinette", id: "b",
    reason: "your account does not include Cathedral Pack" }]);
});

test("returning nothing leaves the entries alone", async () => {
  const before = [{ id: "a" }];
  const { entries, skipped } = await runProviders(before, [{ id: "quiet", hydrate: () => undefined }]);
  assert.equal(entries, before);
  assert.deepEqual(skipped, []);
});

test("enqueueing something unregistered is reported, not ignored", async () => {
  const { skipped } = await runProviders([], [
    { id: "hopeful", hydrate: () => ({ enqueue: ["never-installed"] }) },
  ]);
  assert.match(skipped[0].reason, /not registered/);
});

test("a provider's warnings reach the report alongside its failures", async () => {
  // A document that builds but not as intended is neither a success nor a
  // failure, and only the provider knows: it strips `_stats` on the way past,
  // so the builder cannot check the source generation for itself.
  const { entries, skipped, warnings } = await runProviders([{ id: "a" }], [
    { id: "moulinette", label: "Moulinette", hydrate: (e) => ({
      entries: e,
      warnings: [{ id: "a", reason: "authored for Foundry 13, and this is 14" }],
    }) },
  ]);
  assert.deepEqual(entries.map((x) => x.id), ["a"]);
  assert.deepEqual(skipped, []);
  assert.deepEqual(warnings, [{ provider: "moulinette", id: "a",
    reason: "authored for Foundry 13, and this is 14" }]);
});
