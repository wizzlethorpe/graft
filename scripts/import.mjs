// Building a grafts.json somebody sent you, without a module to put it in.
//
// The same engine, pointed at world compendiums: `Compendium.world.<name>` is
// an ordinary uuid, so `planOrder` and `hydrate` need nothing new. What the
// file cannot know is where it will land, so sibling references are folded back
// to bare ids first and resolved against the packs this import creates.

import { hydrate } from "./hydrate.mjs";
import { FORMAT, readFile } from "./modules.mjs";
import { rewriteSources } from "./patch.mjs";
import { collectTransforms, runTransforms } from "./extend.mjs";
import * as progress from "./progress.mjs";

const WORLD = "world";
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));

/** Foundry moved these; older worlds still have the globals. */
const compendiumClass = () =>
  foundry.documents?.collections?.CompendiumCollection ?? globalThis.CompendiumCollection;

/**
 * Fold a sibling reference back to the bare id it is really making.
 *
 * A file names its own entries by the packs it was authored against, which say
 * nothing about where this import puts them. An id the file defines, in the
 * pack the file put it in, is a reference to itself; anything else is somebody
 * else's content and is left alone.
 */
export function localiseSources(entries) {
  const homePack = new Map();
  for (const entry of entries) {
    if (typeof entry?.id === "string" && typeof entry?.pack === "string") homePack.set(entry.id, entry.pack);
  }
  const map = (source, own) => {
    if (typeof source !== "string" || !source.startsWith("Compendium.")) return source;
    const parts = source.split(".");
    if (parts.length < 5) return source;
    const id = parts[parts.length - 1];
    const pack = parts[parts.length - 3];
    // Never its own id. A document imported out of a pack keeping its id
    // records that pack as where it came from, which reads exactly like a
    // reference to itself and would graft the entry onto its own output.
    if (id === own) return source;
    return homePack.get(id) === pack ? id : source;
  };
  return entries.map((entry) => {
    const mine = (source) => map(source, entry.id);
    const next = { ...entry };
    if (entry.source !== undefined) {
      next.source = Array.isArray(entry.source) ? entry.source.map(mine) : mine(entry.source);
    }
    if (entry.patch !== undefined) next.patch = rewriteSources(entry.patch, mine);
    return next;
  });
}

/** The document types a set of entries needs a pack for, in a stable order. */
export function typesIn(entries) {
  return [...new Set(entries.map((e) => e?.type).filter((t) => typeof t === "string"))].sort();
}

/** `"Kerra's Bestiary"` to `"kerras-bestiary"`, which is what a pack name may be. */
export function packStem(label) {
  const stem = String(label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return stem || "imported-grafts";
}

/** One world compendium per document type, filed together under `label`. */
async function makePacks(label, types) {
  // A folder because one file becomes several packs, and eight loose
  // compendiums named alike is not a thing anyone can navigate.
  let folder = null;
  try { folder = await Folder.create({ name: label, type: "Compendium" }); }
  catch (err) { console.warn("Graft | could not make a compendium folder:", err); }

  const made = new Map();
  for (const type of types) {
    const name = `${packStem(label)}-${type.toLowerCase()}`;
    const collection = `${WORLD}.${name}`;
    if (!game.packs.get(collection)) {
      await compendiumClass().createCompendium({ label: `${label} ${type}`, name, type, package: WORLD });
    }
    // Not part of the metadata a compendium is created with: Foundry keeps
    // where a pack sits in a world setting, written after the pack exists.
    const pack = game.packs.get(collection);
    if (folder && pack) {
      try { await pack.setFolder(folder.id); }
      catch (err) { console.warn(`Graft | could not file ${collection} under ${folder.name}:`, err); }
    }
    made.set(type, name);
  }
  return made;
}

/**
 * Build a file's entries into world compendiums.
 *
 * Pre-build transforms run first, under `"world"` rather than a module id: a
 * file naming a vault builds when the reader has that module, and reports a
 * missing one rather than being refused up front.
 *
 * @returns `{ built, skipped, warnings, removed }`, or null if there was nothing to build.
 */
export async function importGrafts(parsed, label) {
  const file = readFile(parsed);
  if (file.error === "new-format") {
    throw new Error(t("GRAFT.ImportFormat", { format: file.format, reads: FORMAT }));
  }
  if (file.error) throw new Error(t("GRAFT.ImportNotEntries"));
  const declared = file.entries;
  if (declared.length === 0) throw new Error(t("GRAFT.ImportEmpty"));

  progress.begin(`Graft: ${label}`);
  try {
    const prepared = await runTransforms(collectTransforms(WORLD), localiseSources(declared), {
      onTransform: (tr) => progress.phase(tr.label),
    });
    const types = typesIn(prepared.entries);
    if (types.length === 0) {
      throw new Error(t("GRAFT.ImportNoTypes"));
    }
    const packs = await makePacks(label, types);
    // After the packs exist, so an entry names where it is actually going.
    const entries = prepared.entries.map((e) => ({ ...e, pack: packs.get(e.type) ?? e.pack }));

    const result = await hydrate(WORLD, entries, {
      declared: entries,
      onProgress: (i, total, entry) => {
        if (i === 1) progress.phase(t("GRAFT.PhaseBuilding"), total);
        progress.step(entry.id);
      },
    });
    return {
      ...result,
      skipped: [...prepared.skipped, ...result.skipped],
      warnings: [...prepared.warnings, ...result.warnings],
    };
  } finally {
    progress.end();
  }
}
