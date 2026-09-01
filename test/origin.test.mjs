// The one source form graft resolves itself.
//
// An adventure's contents are embedded data, not documents, so they have no
// UUID and `fromUuid` cannot reach them. Without this, anything that came out
// of an adventure could only ever ship as a copy of somebody's text.

import test from "node:test";
import assert from "node:assert/strict";

import { adventureSourceUuid, parseAdventureSource } from "../scripts/origin.mjs";

const ORIGIN = {
  adventure: "Compendium.their-module.their-adventures.Adventure.CeteW6YgiNUi0Ykn",
  id: "azXUvCHjdm7k31my",
};

test("it reads like the embedded UUIDs Foundry already uses", () => {
  assert.equal(
    adventureSourceUuid(ORIGIN, "JournalEntry"),
    `${ORIGIN.adventure}.JournalEntry.azXUvCHjdm7k31my`,
  );
});

test("it round trips", () => {
  const uuid = adventureSourceUuid(ORIGIN, "Scene");
  assert.deepEqual(parseAdventureSource(uuid),
    { adventure: ORIGIN.adventure, type: "Scene", id: ORIGIN.id });
});

test("an ordinary UUID is left for fromUuid", () => {
  // The split has to be unambiguous, or every plain source would take a slow
  // path through an adventure lookup that can never succeed.
  assert.equal(parseAdventureSource("Compendium.dnd5e.items.Item.00BggOkChWztQx6R"), null);
  assert.equal(parseAdventureSource("Actor.abcdefghijklmnop"), null);
  assert.equal(parseAdventureSource("Compendium.a.b.Adventure.CeteW6YgiNUi0Ykn"), null);
});

test("a type an adventure cannot hold is refused", () => {
  // Adventure has no `walls` field, so this is a typo rather than a request.
  assert.equal(parseAdventureSource(`${ORIGIN.adventure}.Wall.azXUvCHjdm7k31my`), null);
  assert.equal(adventureSourceUuid(ORIGIN, "Wall"), null);
  assert.equal(adventureSourceUuid(null, "Actor"), null);
});

test("a document the import updates rather than creates is stamped too", () => {
  // Deterministic ids mean a repeated import, or one made before graft was
  // watching, arrives as an update; unstamped, Copy graft carries it whole.
  const toUpdate = { Actor: [{ _id: "npcBixby00000000", name: "Bixby" }] };
  stampOrigin({ uuid: "Compendium.marlo.adventure.Adventure.advMarlo00000000" }, {}, toUpdate);
  assert.deepEqual(toUpdate.Actor[0].flags.graft.origin,
    { adventure: "Compendium.marlo.adventure.Adventure.advMarlo00000000", id: "npcBixby00000000" });
});
