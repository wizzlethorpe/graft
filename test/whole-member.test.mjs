// Which embedded class a patch path names, and whether a member stands as a document of it.

import test from "node:test";
import assert from "node:assert/strict";

import { embeddedModel, isWholeMember } from "../scripts/hydrate.mjs";
import { filled, needsDocument, required } from "./fake-schema.mjs";

const Effect = { schema: { fields: { name: required } } };
const Item = { schema: { fields: { name: required, type: required, flags: filled, system: needsDocument } }, hierarchy: { effects: { model: Effect } } };
const Actor = { hierarchy: { items: { model: Item }, effects: { model: Effect } } };

test("embeddedModel follows embedded collections, and only those", () => {
  assert.equal(embeddedModel(Actor, ["items"]), Item);
  assert.equal(embeddedModel(Actor, ["items", "effects"]), Effect);
  assert.equal(embeddedModel(Actor, ["system", "advancement"]), undefined);
  assert.equal(embeddedModel(Actor, ["items", "system", "activities"]), undefined);
});

test("a member is whole when it states every field Foundry cannot fill in", () => {
  assert.equal(isWholeMember(Item, { _id: "x", name: "Dagger", type: "weapon" }), true);
  assert.equal(isWholeMember(Item, { _id: "x", flags: { hidden: true } }), false);
  assert.equal(isWholeMember(Item, { _id: "x", name: "Dagger" }), false, "one required field short");
});

test("a field that cannot be asked without its document does not count against the member", () => {
  assert.equal(isWholeMember({ schema: { fields: { system: needsDocument } } }, { _id: "x" }), true);
});

test("a member of an array that is no embedded collection is always kept", () => {
  assert.equal(isWholeMember(undefined, { _id: "x" }), true);
});

test("a tombstone, which is how a token's delta records a deleted item, is whole as it stands", () => {
  assert.equal(isWholeMember(Item, { _id: "x", _tombstone: true }), true);
});
