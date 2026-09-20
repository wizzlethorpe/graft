// The plain-text report a reader copies into a bug report.

import { test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { reportText } from "../scripts/ui.mjs";

const saved = globalThis.game;
afterEach(() => { globalThis.game = saved; });

const install = () => {
  globalThis.game = { version: "14.359", system: { id: "dnd5e", version: "6.0.3" }, modules: { get: () => ({ version: "0.14.0" }) } };
};

test("leads with the versions a maintainer asks for, then every reason, under the heading of whoever gave it", () => {
  install();
  const text = reportText("Southaven", {
    built: ["Actor.actorBase0000001"],
    skipped: [
      { by: "moulinette", id: "13648/maps/a.webp", reason: "not in your Moulinette index" },
      { id: "actorChild000001", reason: "its source did not resolve" },
    ],
    warnings: [
      { id: "sceneYard0000001", reason: "the source has changed where this patch touches it" },
      { by: "http", id: "maps/b.webp", reason: "served without a size" },
    ],
    removed: [{ id: "actorOldGuard001", name: "Old Guard", pack: "actors" }],
  });
  assert.equal(text, [
    "Graft: Southaven",
    "Foundry 14.359, dnd5e 6.0.3, graft 0.14.0",
    "1 built, 2 not built, 2 warnings, 1 removed",
    "",
    "Removed, no longer declared",
    "  Old Guard (actorOldGuard001) from actors",
    "",
    "Not built",
    "  actorChild000001: its source did not resolve",
    "",
    "Not placed by moulinette",
    "  13648/maps/a.webp: not in your Moulinette index",
    "",
    "Built, with warnings",
    "  sceneYard0000001: the source has changed where this patch touches it",
    "  [http] maps/b.webp: served without a size",
    "",
    "Built",
    "  Actor.actorBase0000001",
  ].join("\n"));
});

test("a clean build is three lines and what was built", () => {
  install();
  assert.equal(reportText("My module", { built: ["Item.itemSword0000001"], skipped: [], warnings: [], removed: [] }),
    "Graft: My module\nFoundry 14.359, dnd5e 6.0.3, graft 0.14.0\n1 built, 0 not built, 0 warnings, 0 removed\n\nBuilt\n  Item.itemSword0000001");
});
