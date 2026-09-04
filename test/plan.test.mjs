// Chaining, and the ordering it forces.
//
// The case driving all of this: somebody grafts onto a graft. Their module
// names your output by ordinary UUID and depends on your module, which needs
// nothing new. What does need working out is order, because a patch applied
// before its parent exists is a patch applied to nothing.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { planOrder, entryUuid, adventureId, isDocumentId } from "../scripts/plan.mjs";

const MOD = "my-adventure";
const entry = (id, source, over = {}) =>
  ({ id, source, type: "Actor", pack: "my-actors", patch: {}, ...over });

const MM = "Compendium.some-bestiary.actors.Actor.mmBandit000000";

test("an entry is addressable as an ordinary Foundry UUID", () => {
  // This is why `id` is a document id and not a slug: the result has to be
  // nameable by anything, with none of our code in the loop.
  assert.equal(
    entryUuid(entry("banditCaptain001", MM), MOD),
    "Compendium.my-adventure.my-actors.Actor.banditCaptain001",
  );
});

test("an id that is not a Foundry id is refused, with the reason", () => {
  const { invalid, order } = planOrder([entry("not-a-real-id", MM)], MOD);
  assert.equal(order.length, 0);
  assert.match(invalid[0].reason, /16 characters/);
  assert.equal(isDocumentId("not-a-real-id"), false);
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
  // Somebody else's graft, or a a bestiary entry. Either way `fromUuid`
  // answers at hydration time and Foundry reports a missing dependency
  // better than we could from in here. Nothing to sequence.
  const mine = entry("banditCaptain001", "Compendium.someone-else.pack.Actor.theirEntry00001");
  const { order, invalid } = planOrder([mine], MOD);
  assert.deepEqual(order.map((e) => e.id), ["banditCaptain001"]);
  assert.deepEqual(invalid, []);
});

test("entries that graft onto each other are dropped, not half-built", () => {
  // A document in a pack that nobody can explain is worse than an absent one.
  const a = entry("aaaaaaaaaaaaaaaa", "Compendium.my-adventure.my-actors.Actor.bbbbbbbbbbbbbbbb");
  const b = entry("bbbbbbbbbbbbbbbb", "Compendium.my-adventure.my-actors.Actor.aaaaaaaaaaaaaaaa");

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
  const self = entry("aaaaaaaaaaaaaaaa", "Compendium.my-adventure.my-actors.Actor.aaaaaaaaaaaaaaaa");
  const { order, cycles } = planOrder([self], MOD);
  assert.deepEqual(order, []);
  assert.equal(cycles.length, 1);
});

// ── entries with no source ──────────────────────────────────────────────────

test("an entry with no source is valid, and carries its own content", () => {
  // A graft module is an adventure, not only a pile of derivatives. The things
  // it invents belong in the same pack as the things it borrows, and pressing
  // Copy graft on a document you wrote yourself should produce something the
  // format can express.
  const own = { id: "myOwnCreation001", type: "Actor", pack: "my-actors",
                patch: { name: "The Ashfall Herald" } };
  const { order, invalid } = planOrder([own], MOD);
  assert.deepEqual(invalid, []);
  assert.deepEqual(order.map((e) => e.id), ["myOwnCreation001"]);
});

test("a source that is present but empty is still wrong", () => {
  // Absent means "mine". Empty means somebody meant to name one.
  const { invalid } = planOrder([{ id: "aaaaaaaaaaaaaaaa", source: "", type: "Actor", pack: "p" }], MOD);
  assert.match(invalid[0].reason, /when given/);
});

test("sourceless entries do not disturb the ordering of the rest", () => {
  const own = { id: "myOwnCreation001", type: "Actor", pack: "my-actors", patch: {} };
  const base = entry("banditCaptain001", MM);
  const derived = entry("banditWarlord001", entryUuid(base, MOD));
  const { order } = planOrder([derived, own, base], MOD);
  const ids = order.map((e) => e.id);
  assert.ok(ids.indexOf("banditCaptain001") < ids.indexOf("banditWarlord001"));
  assert.ok(ids.includes("myOwnCreation001"));
});

// ── a source that lists fallbacks ───────────────────────────────────────────

test("a list of sources is valid, and any of them can be an edge", async () => {
  // "The bestiary copy if that module is installed, otherwise the reference
  // one." Whichever resolves, a candidate naming a sibling still has to be
  // built first.
  const { sourcesOf } = await import("../scripts/plan.mjs");
  const base = entry("banditCaptain001", MM);
  const derived = { id: "banditWarlord001", type: "Actor", pack: "my-actors", patch: {},
                    source: ["Compendium.premium.actors.Actor.aaaaaaaaaaaaaaaa", entryUuid(base, MOD)] };

  assert.deepEqual(sourcesOf(derived).length, 2);
  const { order, invalid } = planOrder([derived, base], MOD);
  assert.deepEqual(invalid, []);
  assert.deepEqual(order.map((e) => e.id), ["banditCaptain001", "banditWarlord001"]);
});

test("an empty list is a source somebody meant to fill in", async () => {
  const { sourcesOf } = await import("../scripts/plan.mjs");
  assert.deepEqual(sourcesOf({ source: [] }), []);
  assert.deepEqual(sourcesOf({ source: [42, ""] }), []);
  assert.deepEqual(sourcesOf({}), [], "absent is not empty: it means the content is the author's");

  const { invalid } = planOrder([{ id: "aaaaaaaaaaaaaaaa", type: "Actor", pack: "p", source: [] }], MOD);
  assert.match(invalid[0].reason, /list documents to try in order/);
});

test("two entries sharing an id in one pack are reported, not silently collapsed", () => {
  const a = { id: "aaaaaaaaaaaaaaaa", type: "Actor", pack: "p", patch: { name: "first" } };
  const b = { id: "aaaaaaaaaaaaaaaa", type: "Actor", pack: "p", patch: { name: "second" } };
  const { order, invalid } = planOrder([a, b], MOD);
  assert.equal(order.length, 1);
  assert.equal(invalid.length, 1);
  assert.match(invalid[0].reason, /duplicates/);
});

test("a cycle is reported as the loop, not the path that led into it", () => {
  // A → B → C → B: A is not part of the loop and must still build.
  const uuid = (id) => `Compendium.${MOD}.p.Actor.${id}`;
  const a = { id: "aaaaaaaaaaaaaaaa", type: "Actor", pack: "p", source: uuid("bbbbbbbbbbbbbbbb"), patch: {} };
  const b = { id: "bbbbbbbbbbbbbbbb", type: "Actor", pack: "p", source: uuid("cccccccccccccccc"), patch: {} };
  const c = { id: "cccccccccccccccc", type: "Actor", pack: "p", source: uuid("bbbbbbbbbbbbbbbb"), patch: {} };
  const { order, cycles } = planOrder([a, b, c], MOD);
  assert.deepEqual(cycles, [[uuid("bbbbbbbbbbbbbbbb"), uuid("cccccccccccccccc"), uuid("bbbbbbbbbbbbbbbb")]]);
  assert.deepEqual(order.map((e) => e.id), ["aaaaaaaaaaaaaaaa"]);
});

describe("a source naming a sibling by bare id", () => {
  const entry = (id, over = {}) => ({ id, type: "Actor", pack: "actors", patch: {}, ...over });

  test("resolves to that sibling's uuid", () => {
    const { order } = planOrder([
      entry("bbbbbbbbbbbbbbbb", { source: "aaaaaaaaaaaaaaaa" }),
      entry("aaaaaaaaaaaaaaaa", { source: "Compendium.bestiary.actors.Actor.mmWight000000000" }),
    ], "mine");
    const child = order.find((e) => e.id === "bbbbbbbbbbbbbbbb");
    assert.equal(child.source, "Compendium.mine.actors.Actor.aaaaaaaaaaaaaaaa");
  });

  test("orders the sibling first, as a full uuid would", () => {
    const { order } = planOrder([
      entry("bbbbbbbbbbbbbbbb", { source: "aaaaaaaaaaaaaaaa" }),
      entry("aaaaaaaaaaaaaaaa"),
    ], "mine");
    assert.deepEqual(order.map((e) => e.id), ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
  });

  test("is not confused with a bare type name", () => {
    // No type name is sixteen characters, which is what makes the form safe.
    const { order } = planOrder([entry("aaaaaaaaaaaaaaaa", { source: "Actor:npc" })], "mine");
    assert.equal(order[0].source, "Actor:npc");
  });

  test("names an id two entries share rather than guessing", () => {
    const { invalid } = planOrder([
      entry("aaaaaaaaaaaaaaaa", { pack: "actors" }),
      entry("aaaaaaaaaaaaaaaa", { pack: "npcs" }),
      entry("bbbbbbbbbbbbbbbb", { source: "aaaaaaaaaaaaaaaa" }),
    ], "mine");
    assert.match(invalid.map((i) => i.reason).join("\n"), /names more than one entry/);
  });

  test("names an id that matches nothing", () => {
    const { invalid } = planOrder([entry("bbbbbbbbbbbbbbbb", { source: "cccccccccccccccc" })], "mine");
    assert.match(invalid[0].reason, /names no entry in this module/);
  });
});

describe("an item a patch inserts", () => {
  const actor = (id, itemSource) => ({
    id, type: "Actor", pack: "actors",
    patch: { items: [{ _id: "itemAAAAAAAAAAAA", source: itemSource, patch: {} }] },
  });

  test("orders the entry it names first, wherever it sits in the file", () => {
    // Before this the edge was never recorded, so the order was whatever the
    // file happened to be and the actor failed when it came first.
    const { order } = planOrder([
      actor("bbbbbbbbbbbbbbbb", "Compendium.mine.items.Item.aaaaaaaaaaaaaaaa"),
      { id: "aaaaaaaaaaaaaaaa", type: "Item", pack: "items", patch: {} },
    ], "mine");
    assert.deepEqual(order.map((e) => e.id), ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
  });

  test("takes a bare id too, and rewrites it", () => {
    const { order } = planOrder([
      actor("bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"),
      { id: "aaaaaaaaaaaaaaaa", type: "Item", pack: "items", patch: {} },
    ], "mine");
    assert.deepEqual(order.map((e) => e.id), ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
    const built = order.find((e) => e.id === "bbbbbbbbbbbbbbbb");
    assert.equal(built.patch.items[0].source, "Compendium.mine.items.Item.aaaaaaaaaaaaaaaa");
  });

  test("reports a loop through an inserted item", () => {
    const { cycles } = planOrder([
      actor("aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"),
      actor("bbbbbbbbbbbbbbbb", "aaaaaaaaaaaaaaaa"),
    ], "mine");
    assert.equal(cycles.length > 0, true);
  });
});

describe("an entry bound for an Adventure pack", () => {
  // The pack's declared type decides, so the plan is told which packs are
  // Adventures rather than reading anything off the entry.
  const adventures = new Set(["adv"]);
  const ADV = adventureId("mod", "adv");
  const entry = (id, over = {}) => ({ id, type: "Actor", pack: "adv", patch: {}, ...over });

  test("is addressed through the Adventure, in the form origin.mjs resolves", () => {
    assert.equal(
      entryUuid(entry("aaaaaaaaaaaaaaaa"), "mod", adventures),
      `Compendium.mod.adv.Adventure.${ADV}.Actor.aaaaaaaaaaaaaaaa`,
    );
  });

  test("a bare sibling id resolves to that address", () => {
    const { order, invalid } = planOrder([
      entry("bbbbbbbbbbbbbbbb", { source: "aaaaaaaaaaaaaaaa" }),
      entry("aaaaaaaaaaaaaaaa"),
    ], "mod", adventures);
    assert.deepEqual(invalid, []);
    assert.deepEqual(order.map((e) => e.id), ["aaaaaaaaaaaaaaaa", "bbbbbbbbbbbbbbbb"]);
    assert.equal(order[1].source, `Compendium.mod.adv.Adventure.${ADV}.Actor.aaaaaaaaaaaaaaaa`);
  });

  test("Adventure is not an entry type", () => {
    const { invalid, order } = planOrder([entry("aaaaaaaaaaaaaaaa", { type: "Adventure" })], "mod");
    assert.deepEqual(order, []);
    assert.match(invalid[0].reason, /packaging/);
  });
});
