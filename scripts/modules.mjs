// Which modules use graft, and what they declare.
//
// The non-UI half: everything here answers a question about a manifest or a
// pack index, with nothing on screen.

const MODULE_ID = "graft";

/**
 * The entry format this version understands.
 *
 * A newer file is refused rather than half-read: the fields it relies on would
 * be ignored silently, which is worse than saying the module needs a newer graft.
 */
export const FORMAT = 1;

/** The format a grafts file declares, or null if what it declares is not one. Absent means the first. */
export const formatOf = (parsed) => {
  const declared = parsed?.format ?? FORMAT;
  return Number.isInteger(declared) && declared > 0 ? declared : null;
};

/** A grafts file's entries, or null if it is not one. */
const entriesIn = (parsed) => (Array.isArray(parsed?.entries) ? parsed.entries : null);

/**
 * A grafts file's entries, or which check refused it.
 *
 * Both readers ask this and answer for their own audience: the console for the
 * author of a module, a dialog for the reader building a file by hand.
 */
export function readFile(parsed) {
  if (Array.isArray(parsed)) return { error: "old-format" };
  const format = formatOf(parsed);
  if (format === null) return { error: "bad-format", declared: parsed?.format };
  if (format > FORMAT) return { error: "new-format", format };
  const entries = entriesIn(parsed);
  if (!entries) return { error: "no-entries" };
  return { entries };
}

/** What to tell the author of a file graft would not read. */
function refusal(result, where) {
  switch (result.error) {
    case "old-format":
      return `${where} is a bare list, which graft no longer reads. Wrap it: { "format": ${FORMAT}, "entries": [ … ] }.`;
    case "bad-format":
      return `${where} declares ${JSON.stringify(result.declared)} as its format, which is not a format number.`;
    case "new-format":
      return `${where} is format ${result.format}; this graft reads ${FORMAT}. Update graft.`;
    default:
      return `${where} declares no "entries" list.`;
  }
}

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
export async function readGrafts(moduleId, { onRefused } = {}) {
  const named = game.modules.get(moduleId)?.flags?.graft?.entries;
  const files = Array.isArray(named) ? named
    : typeof named === "string" ? [named]
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
    const result = readFile(parsed);
    if (result.error) {
      console.warn(`Graft | ${refusal(result, `${moduleId}/${file}`)}`);
      onRefused?.({ moduleId, file, error: result.error });
      continue;
    }
    entries.push(...result.entries);
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
export async function unbuilt(moduleId, options) {
  const byPack = new Map();
  for (const entry of await readGrafts(moduleId, options)) {
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
