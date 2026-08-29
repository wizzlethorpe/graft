// The pure half of the Moulinette provider: parsing references, and the walk
// that rewrites them. Downloading is injected, so none of this needs Foundry.

import test from "node:test";
import assert from "node:assert/strict";

import { parseRef, isMoulinetteRef, rewriteRefs } from "../scripts/moulinette.mjs";

const REF = "@moulinette/10698/scenes/abandoned-mine-entrance.webp";

test("a reference is a pack number and a filepath", () => {
  // The number is the identifier. The slugs beside it in a marketplace URL are
  // display names, so they change when a creator renames a pack.
  assert.deepEqual(parseRef(REF), { pack: "10698", file: "scenes/abandoned-mine-entrance.webp" });
  assert.deepEqual(parseRef("@moulinette/10698/a/b/c.ogg"),
    { pack: "10698", file: "a/b/c.ogg" }, "creators nest folders inside a pack");
});

test("anything else is not a reference", () => {
  assert.equal(parseRef("@moulinette/10698"), null, "a pack alone names no asset");
  assert.equal(parseRef("@moulinette/"), null);
  assert.equal(parseRef("icons/svg/mystery-man.svg"), null);
  assert.equal(isMoulinetteRef(REF), true);
  assert.equal(isMoulinetteRef(null), false);
});

test("references are replaced by where they landed", async () => {
  const resolve = async () => "moulinette/cloud/mine.webp";
  const { value } = await rewriteRefs(
    { name: "Mine", background: { src: REF }, sounds: [{ path: REF }] }, resolve);
  assert.deepEqual(value, {
    name: "Mine",
    background: { src: "moulinette/cloud/mine.webp" },
    sounds: [{ path: "moulinette/cloud/mine.webp" }],
  });
});

test("what cannot resolve takes its container with it, one level", async () => {
  // A background with no src is worse than no background, so the parent drops
  // it. It stops there: one missing ambience must not discard a whole scene.
  const { value, viable } = await rewriteRefs({
    name: "Mine",
    background: { src: REF },
    sounds: [{ path: REF }, { path: "sounds/kept.ogg" }],
  }, async () => null);

  assert.equal(viable, true, "the scene itself survives");
  assert.ok(!("background" in value), "but the unusable background goes");
  assert.deepEqual(value.sounds, [{ path: "sounds/kept.ogg" }], "and the unusable sound");
  assert.equal(value.name, "Mine");
});

test("resolution is per reference, so a shared asset is fetched once", async () => {
  // Not memoised here; this checks the walk asks once per occurrence and the
  // caller's cache is what makes that cheap.
  const asked = [];
  await rewriteRefs({ a: { src: REF }, b: { src: REF } }, async (r) => { asked.push(r); return "x"; });
  assert.deepEqual(asked, [REF, REF]);
});

test("a tree with no references is returned unchanged", async () => {
  const before = { name: "Local", background: { src: "worlds/mine/map.webp" }, walls: [{ c: [0, 0, 1, 1] }] };
  const { value, viable } = await rewriteRefs(before, async () => { throw new Error("must not resolve"); });
  assert.deepEqual(value, before);
  assert.equal(viable, true);
});
