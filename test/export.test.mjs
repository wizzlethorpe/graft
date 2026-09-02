// `exportDiff`: which of four shapes an entry takes, and in what order the
// question is asked. Every bug this code has had was in that ordering.

import test from "node:test";
import assert from "node:assert/strict";

import { installFoundry, uninstallFoundry, asDocument } from "./foundry-stub.mjs";

const SOURCE = "Compendium.some-bestiary.actors.Actor.mmBandit000000";
const bandit = {
  _id: "mmBandit000000", name: "Bandit", type: "Actor",
  system: { attributes: { hp: { value: 11 } } },
  _stats: { coreVersion: "14.367", systemId: "dnd5e", systemVersion: "5.3.3" },
};

const setup = (opts) => {
  installFoundry({ uuids: { [SOURCE]: bandit }, ...opts });
  return import("../scripts/hydrate.mjs");
};

test.afterEach(() => uninstallFoundry());

test("a document in an installable pack is a reference, not a replayed patch", async () => {
  // Asked first, and the order is what makes chaining work: graft's own output
  // lives in module packs, so Copy graft on a built document must point at it.
  const { exportDiff } = await setup({ packs: { "my-mod.my-actors": { packageType: "module" } } });
  const built = asDocument({ ...bandit, name: "The Enforcer",
    _stats: { ...bandit._stats, compendiumSource: SOURCE } }, { pack: "my-mod.my-actors" });

  const entry = await exportDiff(built);
  assert.equal(entry.source, built.uuid, "points at itself, where anyone can get it");
  assert.deepEqual(entry.patch, {});
  assert.ok(!("sourceHash" in entry), "nothing patched, nothing to drift");
});

test("a world pack is a workbench, so its documents are diffed", async () => {
  const { exportDiff } = await setup({ packs: { "world.bench": { packageType: "world" } } });
  const edited = asDocument({ ...bandit, name: "The Enforcer",
    _stats: { ...bandit._stats, compendiumSource: SOURCE } }, { pack: "world.bench" });

  const entry = await exportDiff(edited);
  assert.equal(entry.source, SOURCE);
  assert.deepEqual(entry.patch, { name: "The Enforcer" });
});

test("an edited world document is diffed against where it came from", async () => {
  const { exportDiff } = await setup();
  const mine = structuredClone(bandit);
  mine.name = "The Enforcer";
  mine.system.attributes.hp.value = 45;
  mine._stats = { ...bandit._stats, compendiumSource: SOURCE };

  const entry = await exportDiff(asDocument(mine));
  assert.equal(entry.source, SOURCE);
  assert.deepEqual(entry.patch, {
    name: "The Enforcer",
    system: { attributes: { hp: { value: 45 } } },
  });
  assert.equal(typeof entry.sourceHash, "string", "recorded so drift can be seen later");
});

test("a document the author wrote travels whole", async () => {
  const { exportDiff } = await setup();
  const mine = { _id: "myOwnCreation001", name: "The Herald", type: "Actor", system: {} };

  const entry = await exportDiff(asDocument(mine));
  assert.ok(!("source" in entry), "absent means this is mine");
  assert.equal(entry.patch.name, "The Herald");
});

test("a source that is installed but disabled refuses, and says so", async () => {
  // The reader can fix this one, so it should stop rather than degrade.
  const { exportDiff } = await setup({ modules: { "some-bestiary": { title: "A Bestiary", active: false } } });
  const orphan = asDocument({ ...bandit,
    _stats: { ...bandit._stats, compendiumSource: "Compendium.some-bestiary.actors.Actor.gone000000000000" } });

  await assert.rejects(() => exportDiff(orphan), /installed\s+but not enabled/);
});

test("a source nobody can install degrades instead of failing", async () => {
  // Publishers assemble in private modules and that id survives into published
  // content. Telling the reader to enable it would be advice they cannot take.
  const { exportDiff } = await setup();
  const orphan = asDocument({ ...bandit,
    _stats: { ...bandit._stats, compendiumSource: "Compendium.private-workmodule.actors.Actor.x000000000000000" } });

  const entry = await exportDiff(orphan);
  assert.ok(!("source" in entry), "treated as having none");
  assert.equal(entry.patch.name, "Bandit", "so it carries its content, visibly");
});

test("_stats and per-user ownership never reach a patch", async () => {
  const { exportDiff } = await setup();
  const mine = structuredClone(bandit);
  mine.name = "The Enforcer";
  mine.ownership = { default: 0, K5n12UWOfcmnnwjH: 3 };
  mine._stats = { ...bandit._stats, compendiumSource: SOURCE, lastModifiedBy: "K5n12UWOfcmnnwjH" };

  const entry = await exportDiff(asDocument(mine));
  const text = JSON.stringify(entry);
  assert.equal(text.includes("K5n12UWOfcmnnwjH"), false);
  assert.equal(text.includes("lastModifiedBy"), false);
});

test("a module that fetched the source gets the last word on naming it", async () => {
  // The hook's only production call site; without it Copy graft emits the
  // compendium UUID a companion module happens to file its content under.
  const { exportDiff } = await setup();
  globalThis.Hooks = { callAll: (_name, register) => register({
    id: "graft-moulinette",
    rewrite: (entry) => ({ ...entry, source: "@moulinette/Actor/10698/json/actor/bandit.json" }),
  }) };
  const mine = { ...bandit, _stats: { ...bandit._stats, compendiumSource: SOURCE } };

  const entry = await exportDiff(asDocument(mine));
  assert.equal(entry.source, "@moulinette/Actor/10698/json/actor/bandit.json");
});

test("a rewriter that returns nothing leaves the entry alone", async () => {
  const { exportDiff } = await setup();
  globalThis.Hooks = { callAll: (_name, register) => register({ id: "quiet", rewrite: () => undefined }) };
  const mine = { ...bandit, _stats: { ...bandit._stats, compendiumSource: SOURCE } };

  const entry = await exportDiff(asDocument(mine));
  assert.equal(entry.source, SOURCE);
});
