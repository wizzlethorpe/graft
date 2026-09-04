// Folding built entries into one Adventure: content filed by type, folders
// derived per type with their parents, ids deterministic so a reader's
// re-import updates in place rather than making a second everything.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { assembleAdventure, adventureFolderId, adventureFolderOf, membersOf } from "../scripts/assemble.mjs";
import { adventureId } from "../scripts/plan.mjs";

const MOD = "tryk";
const PACK = "tryk-adventure";
const META = { label: "Tryk Academy", flags: { graft: { description: "<p>A school.</p>" } } };

const member = (type, id, folder) => ({
  id, type, folder, uuid: "",
  data: { _id: id, name: id, folder: adventureFolderOf(MOD, PACK, { type, folder }) },
});

describe("assembleAdventure", () => {
  test("files each member under the field for its type", () => {
    const adv = assembleAdventure(MOD, PACK, META, [
      member("Actor", "actor00000000001"),
      member("JournalEntry", "journal000000001"),
      member("Actor", "actor00000000002"),
    ]);
    assert.deepEqual(adv.actors.map((d) => d._id), ["actor00000000001", "actor00000000002"]);
    assert.deepEqual(adv.journal.map((d) => d._id), ["journal000000001"]);
    assert.equal("scenes" in adv, false);
  });

  test("makes a typed folder for every path segment, and links parents", () => {
    // Foundry folders are typed, so `NPCs` holding Actors and `NPCs` holding
    // Scenes are two folders.
    const adv = assembleAdventure(MOD, PACK, META, [
      member("Actor", "actor00000000001", "NPCs/Guards"),
      member("Scene", "scene00000000001", "NPCs"),
    ]);
    assert.equal(adv.folders.length, 3);
    const guards = adv.folders.find((f) => f.name === "Guards");
    assert.equal(guards.type, "Actor");
    assert.equal(guards.folder, adventureFolderId(MOD, PACK, "Actor", ["NPCs"]));
    assert.equal(adv.folders.find((f) => f.name === "NPCs" && f.type === "Actor").folder, null);
    assert.equal(adv.actors[0].folder, guards._id, "and the member points at its folder");
    assert.equal(adv.scenes[0].folder, adv.folders.find((f) => f.type === "Scene")._id);
  });

  test("is named and described from the pack declaration", () => {
    const adv = assembleAdventure(MOD, PACK, META, []);
    assert.equal(adv._id, adventureId(MOD, PACK));
    assert.equal(adv.name, "Tryk Academy");
    assert.equal(adv.description, "<p>A school.</p>");
    assert.deepEqual(adv.folders, []);
  });
});

describe("membersOf", () => {
  test("reads members back with the folder paths they were filed under", () => {
    const members = [
      member("Actor", "actor00000000001", "NPCs/Guards"),
      member("Scene", "scene00000000001", "NPCs"),
      member("Item", "item000000000001"),
    ];
    const back = membersOf(assembleAdventure(MOD, PACK, META, members));
    const shape = (list) => list.map((m) => [m.id, m.type, m.folder]).sort();
    assert.deepEqual(shape(back), shape(members));
    assert.ok(back.every((m) => m.data.folder === adventureFolderOf(MOD, PACK, m)));
  });
});

describe("deterministic ids", () => {
  test("the adventure id follows from the module and pack, and is a document id", () => {
    assert.notEqual(adventureId(MOD, PACK), adventureId(MOD, "other"));
    assert.match(adventureId(MOD, PACK), /^[a-f0-9]{16}$/);
  });

  test("a folder id follows from its type and normalised path", () => {
    assert.match(adventureFolderId(MOD, PACK, "Actor", ["NPCs"]), /^[a-f0-9]{16}$/);
    assert.notEqual(adventureFolderId(MOD, PACK, "Actor", ["NPCs"]), adventureFolderId(MOD, PACK, "Scene", ["NPCs"]));
    assert.equal(
      adventureFolderOf(MOD, PACK, { type: "Actor", folder: " NPCs / Guards " }),
      adventureFolderId(MOD, PACK, "Actor", ["NPCs", "Guards"]),
    );
    assert.equal(adventureFolderOf(MOD, PACK, { type: "Actor" }), null);
  });
});
