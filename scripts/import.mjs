// Building a grafts.json somebody sent you, into the world.
//
// The same engine, pointed at world collections rather than a module's packs.
// What the file cannot know is which module it came from, so references to its
// own entries are folded back to bare ids first and resolve against what this
// import builds.

import { hydrateWorld } from "./hydrate.mjs";
import { FORMAT, readFile } from "./modules.mjs";
import { rewriteSources } from "./patch.mjs";
import { collectTransforms, runTransforms } from "./extend.mjs";
import * as progress from "./progress.mjs";
import { t } from "./i18n.mjs";

const WORLD = "world";

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
    const pack = parts[2];
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

/**
 * Build a file's entries into the world, filed under `label`.
 *
 * Pre-build transforms run first, under `"world"` rather than a module id: a
 * file naming a vault builds when the reader has that module, and reports a
 * missing one rather than being refused up front.
 *
 * @returns `{ built, skipped, warnings }`.
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
    const result = await hydrateWorld(prepared.entries, label, {
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
