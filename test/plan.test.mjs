// Chaining, and the ordering it forces.
//
// The case driving all of this: somebody grafts onto a graft. Their module
// names your output by ordinary UUID and depends on your module, which needs
// nothing new. What does need working out is order, because a patch applied
// before its parent exists is a patch applied to nothing.

import test from "node:test";
import assert from "node:assert/strict";

import { planOrder, entryUuid, isDocumentId } from "../scripts/plan.mjs";

const MOD = "marlo-mystery";
const entry = (id, source, over = {}) =>
  ({ id, source, type: "Actor", pack: "marlo-actors", patch: {}, ...over });

const MM = "Compendium.dnd-monster-manual.actors.Actor.mmBandit000000";

test("an entry is addressable as an ordinary Foundry UUID", () => {
  // This is why `id` is a document id and not a slug: the result has to be
  // nameable by anything, with none of our code in the loop.
  assert.equal(
    entryUuid(entry("banditCaptain001", MM), MOD),
    "Compendium.marlo-mystery.marlo-actors.Actor.banditCaptain001",
  );
});

test("an id that is not a Foundry id is refused, with the reason", () => {
  const { invalid, order } = planOrder([entry("marlo-enforcer", MM)], MOD);
  assert.equal(order.length, 0);
  assert.match(invalid[0].reason, /16 characters/);
  assert.equal(isDocumentId("marlo-enforcer"), false);
  assert.equal(isDocumentId("banditCaptain001"), true);
});

test("a graft onto a sibling is applied after it", () => {
  // Declared in the wrong order on purpose: the file's order is the author's
  // convenience, not a build instruction.
  const base = entry("banditCaptain001", MM);
  const derived = entry("banditWarlord001", entryUuid(base, MOD));

  const { order } = planOrder([derived, base], MOD);
  assert.deepEqual(order.map((e) => e.id), ["banditCaptain001", "banditWarlord001"]);
});

test("a chain of three resolves end to end", () => {
  const a = entry("aaaaaaaaaaaaaaaa", MM);
  const b = entry("bbbbbbbbbbbbbbbb", entryUuid(a, MOD));
  const c = entry("cccccccccccccccc", entryUuid(b, MOD));

  const { order, cycles } = planOrder([c, b, a], MOD);
  assert.deepEqual(order.map((e) => e.id), ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb", "cccccccccccccccc"]);
  assert.deepEqual(cycles, []);
});

test("a source outside this module is left alone", () => {
  // Somebody else's graft, or a Monster Manual entry. Either way `fromUuid`
  // answers at hydration time and Foundry reports a missing dependency
  // better than we could from in here. Nothing to sequence.
  const mine = entry("banditCaptain001", "Compendium.someone-else.pack.Actor.theirEntry00001");
  const { order, invalid } = planOrder([mine], MOD);
  assert.deepEqual(order.map((e) => e.id), ["banditCaptain001"]);
  assert.deepEqual(invalid, []);
});

test("entries that graft onto each other are dropped, not half-built", () => {
  // A document in a pack that nobody can explain is worse than an absent one.
  const a = entry("aaaaaaaaaaaaaaaa", "Compendium.marlo-mystery.marlo-actors.Actor.bbbbbbbbbbbbbbbb");
  const b = entry("bbbbbbbbbbbbbbbb", "Compendium.marlo-mystery.marlo-actors.Actor.aaaaaaaaaaaaaaaa");

  const { order, cycles } = planOrder([a, b], MOD);
  assert.deepEqual(order, []);
  assert.equal(cycles.length > 0, true, "and the loop itself is reported, not just its existence");
  assert.ok(cycles[0].some((u) => u.includes("aaaaaaaaaaaaaaaa")));
});

test("one bad entry does not take the buildable ones with it", () => {
  const good = entry("banditCaptain001", MM);
  const bad = entry("nope", MM);
  const { order, invalid } = planOrder([bad, good], MOD);
  assert.deepEqual(order.map((e) => e.id), ["banditCaptain001"]);
  assert.equal(invalid.length, 1);
});

test("an entry that grafts onto itself is a cycle, not a no-op", () => {
  const self = entry("aaaaaaaaaaaaaaaa", "Compendium.marlo-mystery.marlo-actors.Actor.aaaaaaaaaaaaaaaa");
  const { order, cycles } = planOrder([self], MOD);
  assert.deepEqual(order, []);
  assert.equal(cycles.length, 1);
});
