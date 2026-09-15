// Building grafts somebody sent you into the world: the same engine, pointed
// at world collections rather than a module's packs.

import { hydrateWorld } from "./hydrate.mjs";
import { runBuild } from "./build.mjs";
import { FORMAT, readFile } from "./modules.mjs";
import { rewriteSources } from "./patch.mjs";
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
 * Build a pasted grafts file into the world. Transforms run under `"world"` as
 * the module id.
 *
 * @returns `{ built, skipped, warnings, removed }`.
 */
export async function importGrafts(parsed, { redownload } = {}) {
  const file = readFile(parsed);
  if (file.error === "new-format") {
    throw new Error(t("GRAFT.ImportFormat", { format: file.format, reads: FORMAT }));
  }
  if (file.error === "bad-assets") throw new Error(t("GRAFT.ImportBadAssets"));
  if (file.error) throw new Error(t("GRAFT.ImportNotEntries"));
  if (file.entries.length === 0) throw new Error(t("GRAFT.ImportEmpty"));
  return runBuild({
    moduleId: WORLD,
    title: t("GRAFT.ImportTitle"),
    assets: file.assets,
    entries: localiseSources(file.entries),
    redownload,
    write: hydrateWorld,
  });
}
