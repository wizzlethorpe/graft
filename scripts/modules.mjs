// Which modules use graft, and what they declare.
//
// The non-UI half: everything here answers a question about a manifest or a
// pack index, with nothing on screen.

const MODULE_ID = "graft";

/**
 * The entry format this version understands.
 *
 * A file may declare `"format": <n>`. Every change so far has been additive, so
 * an older file reads fine and an absent version means 1. A file declaring a
 * newer one is refused rather than half-read: the fields it relies on would be
 * silently ignored, which is worse than saying the module needs a newer graft.
 */
const FORMAT = 1;

/** Enabled modules that require graft, which is the convention for using it. */
export function graftModules() {
  return game.modules.filter((m) => m.active
    && [...(m.relationships?.requires ?? [])].some((r) => r.id === MODULE_ID));
}

/** Whether a module ships grafts, as opposed to code that helps build them. */
export function shipsEntries(module) {
  const declared = module.flags?.graft?.entries;
  return !(Array.isArray(declared) && declared.length === 0);
}

/**
 * A module's entries, or [] when it ships none.
 *
 * `flags.graft.entries` says where to look, so a large module can split them by
 * pack or by chapter. Defaulting to `grafts.json` keeps the simple case free of
 * ceremony, and is why a missing default file is silent where a declared one
 * that cannot be read is a warning.
 */
export async function readGrafts(moduleId) {
  const declared = game.modules.get(moduleId)?.flags?.graft?.entries;
  const files = Array.isArray(declared) ? declared
    : typeof declared === "string" ? [declared]
    : null;

  const entries = [];
  for (const file of files ?? ["grafts.json"]) {
    let parsed = null;
    try {
      const res = await fetch(`modules/${moduleId}/${file}`);
      if (res.ok) parsed = await res.json();
    } catch { /* reported below */ }

    if (parsed === null) {
      if (files) console.warn(`Graft | ${moduleId} declares ${file}, which could not be read.`);
      continue;
    }
    const format = Array.isArray(parsed) ? FORMAT : Number(parsed.format ?? FORMAT);
    if (format > FORMAT) {
      console.warn(`Graft | ${moduleId}/${file} is format ${format}; this graft reads ${FORMAT}. Update graft.`);
      continue;
    }
    entries.push(...(Array.isArray(parsed) ? parsed : parsed.entries ?? []));
  }
  return entries;
}

/**
 * The entries a module declares that are not in its packs.
 *
 * Read from the pack index rather than a stored "already built" flag, so the
 * answer stays true when a document is deleted by hand or an update ships new
 * entries.
 */
export async function unbuilt(moduleId) {
  const byPack = new Map();
  for (const entry of await readGrafts(moduleId)) {
    if (!entry?.id) continue;                  // planOrder reports these
    if (!byPack.has(entry.pack)) byPack.set(entry.pack, []);
    byPack.get(entry.pack).push(entry);
  }

  const missing = [];
  for (const [name, entries] of byPack) {
    const pack = game.packs.get(`${moduleId}.${name}`);
    if (!pack) continue;                       // a pack Foundry has not read yet
    const index = await pack.getIndex();
    missing.push(...entries.filter((e) => !index.get(e.id)));
  }
  return missing;
}

/**
 * Whether anything graft built for this module is still in its packs.
 *
 * `unbuilt` cannot answer this for a module whose entries a transform
 * expands: its `grafts.json` names a source to fetch rather than the entries
 * themselves, so there are no ids to look up until a build has already run.
 * Pack contents are what is knowable without fetching anything.
 *
 * Graft's own documents only. `flags.graft.built` is on everything it creates,
 * so one a reader added to the pack by hand never reads as a build.
 */
export async function anyBuilt(moduleId) {
  for (const declared of game.modules.get(moduleId)?.packs ?? []) {
    const pack = game.packs.get(`${moduleId}.${declared.name}`);
    if (!pack) continue;                       // a pack Foundry has not read yet
    const index = await pack.getIndex({ fields: ["flags.graft.built"] });
    if (index.some((e) => e?.flags?.graft?.built)) return true;
  }
  return false;
}

/**
 * Fill in the pack an entry belongs in, when there is only one it could be.
 *
 * `exportDiff` cannot know which module is being authored, but the answer is
 * usually forced. Left blank when genuinely ambiguous: a missing pack fails at
 * build time with an obvious message, a wrong one with a confusing one.
 */
export function withPack(entry) {
  if (entry.pack) return entry;
  const declared = [];
  const candidates = [];
  for (const module of graftModules().filter(shipsEntries)) {
    const named = module.flags?.graft?.packs?.[entry.type];
    if (named) declared.push(named);
    for (const pack of module.packs ?? []) {
      if (pack.type === entry.type) candidates.push(pack.name);
    }
  }
  // `flags.graft.packs` exists for the case inference cannot handle: two packs
  // of one type and no way to tell which is meant.
  if (declared.length === 1) return { ...entry, pack: declared[0] };
  return candidates.length === 1 ? { ...entry, pack: candidates[0] } : entry;
}
