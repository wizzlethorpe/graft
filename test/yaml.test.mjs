// The clipboard output.
//
// Worth testing because it is the one piece of the authoring loop with no
// safety net: a patch that round-trips perfectly in memory is still useless if
// what lands on the clipboard does not parse, and the author finds out by
// pasting it somewhere and getting a confusing error much later.

import test from "node:test";
import assert from "node:assert/strict";

import { toYaml } from "../scripts/yaml.mjs";

test("an entry comes out as pasteable YAML", () => {
  const out = toYaml({
    id: "banditCaptain001",
    type: "Actor",
    source: "Compendium.dnd-monster-manual.actors.Actor.mmBandit000000",
    patch: { name: "Marlo's Enforcer" },
  });
  assert.match(out, /^id: banditCaptain001$/m);
  assert.match(out, /^type: Actor$/m);
  assert.match(out, /^patch:$/m);
  assert.match(out, /^ {2}name: Marlo's Enforcer$/m);
});

test("nesting indents rather than flattening", () => {
  const out = toYaml({ patch: { system: { attributes: { hp: { value: 45 } } } } });
  assert.match(out, /^patch:\n {2}system:\n {4}attributes:\n {6}hp:\n {8}value: 45$/m);
});

test("a deletion stays null and does not become the string", () => {
  // The whole meaning of a deletion is that it is null, per RFC 7386. Quoting
  // it would turn "remove this key" into "set it to the text null".
  const out = toYaml({ patch: { system: { details: { cr: null } } } });
  assert.match(out, /cr: null$/m);
  assert.doesNotMatch(out, /cr: "null"/);
});

test("a string that reads as another type is quoted", () => {
  // Foundry data is full of these. An unquoted `true` or `12` changes type on
  // the way back in, and the patch then sets a boolean where a string belongs.
  const out = toYaml({ patch: { a: "true", b: "12", c: "null", d: "2d8", e: "Light Crossbow" } });
  assert.match(out, /a: "true"/);
  assert.match(out, /b: "12"/);
  assert.match(out, /c: "null"/);
  assert.match(out, /d: 2d8/, "a damage formula is not a number and needs no quotes");
  assert.match(out, /e: Light Crossbow/);
});

test("a keyed array comes out as a list of entries", () => {
  const out = toYaml({ patch: { items: [{ _id: "itemCrossbow001", system: { damage: "2d8" } }] } });
  assert.match(out, /items:\n {4}- _id: itemCrossbow001/);
  assert.match(out, /damage: 2d8/);
});

test("empty structures are explicit rather than blank", () => {
  // `patch:` with nothing after it parses as null, not as an empty patch.
  assert.match(toYaml({ patch: {} }), /patch: \{\}/);
  assert.match(toYaml({ items: [] }), /items: \[\]/);
});
