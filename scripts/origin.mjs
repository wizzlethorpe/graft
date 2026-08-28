// Where a document in this world actually came from.
//
// Foundry's own answer is `_stats.compendiumSource`, and on the ordinary path
// it is a good one: `WorldCollection#fromCompendium` computes it from the pack
// you dragged out of, so it is fresh by construction.
//
// Adventure import does not go through that function. It writes the embedded
// document data with `keepId`, `_stats` and all, so whatever the publisher
// stamped survives into your world. The MAD Cartographer built Flesh Mountain
// in a private module called `aa-mad-workmodule`, and every copy of that
// adventure in the world claims to have come from a module nobody outside that
// studio can install.
//
// So we record it ourselves, at the one moment it is knowable, from the
// adventure we are demonstrably importing.

const MODULE_ID = "graft";

/**
 * Stamp each document an adventure import is about to create.
 *
 * `preImportAdventure` hands over `toCreate` as plain document data, by
 * reference, before anything exists. The adventure's own UUID is a real one
 * and resolves for anybody who owns the module, which is the whole difference
 * from the stamp it would otherwise carry.
 */
export function stampOrigin(adventure, toCreate) {
  const origin = { adventure: adventure.uuid, id: null };
  for (const documents of Object.values(toCreate ?? {})) {
    for (const data of documents ?? []) {
      // `id` is recorded rather than inferred: import keeps ids today, and a
      // pointer that does not depend on that staying true costs nothing.
      foundry.utils.setProperty(data, `flags.${MODULE_ID}.origin`, { ...origin, id: data._id });
    }
  }
}

/** What we recorded, or null for anything imported before graft was watching. */
export function originOf(document) {
  const origin = document?.flags?.[MODULE_ID]?.origin;
  return origin?.adventure ? origin : null;
}

// An adventure's contents are not documents. The schema holds them as embedded
// data, so they have no UUID of their own and `fromUuid` cannot reach them.
// That is why Flesh Mountain's journal could only ever ship as a copy.
//
// Since we know the adventure and the id, graft resolves one form of its own,
// written to read exactly like the embedded UUIDs Foundry does support:
//
//   Compendium.<mod>.<pack>.Adventure.<advId>.JournalEntry.<docId>
//
// It is the one source graft resolves itself rather than handing to `fromUuid`.
// The alternative was shipping somebody's entire adventure text inside a patch.

/** Adventure schema field per document type. */
const ADVENTURE_FIELDS = {
  Actor: "actors", Cards: "cards", Combat: "combats", Folder: "folders",
  Item: "items", JournalEntry: "journal", Macro: "macros",
  Playlist: "playlists", RollTable: "tables", Scene: "scenes",
};

const ADVENTURE_SOURCE =
  /^(Compendium\..+\.Adventure\.[a-zA-Z0-9]{16})\.([A-Za-z]+)\.([a-zA-Z0-9]{16})$/;

/** The source UUID for a document we watched an adventure import. */
export function adventureSourceUuid(origin, documentName) {
  if (!origin?.adventure || !ADVENTURE_FIELDS[documentName]) return null;
  return `${origin.adventure}.${documentName}.${origin.id}`;
}

export function parseAdventureSource(uuid) {
  const m = typeof uuid === "string" ? ADVENTURE_SOURCE.exec(uuid) : null;
  if (!m || !ADVENTURE_FIELDS[m[2]]) return null;
  return { adventure: m[1], type: m[2], id: m[3] };
}

/** Plain data for one document inside an adventure, or null. */
export async function resolveAdventureSource(uuid) {
  const parsed = parseAdventureSource(uuid);
  if (!parsed) return null;
  const adventure = await fromUuid(parsed.adventure);
  if (!adventure) return null;
  for (const entry of adventure[ADVENTURE_FIELDS[parsed.type]] ?? []) {
    const data = entry?.toObject?.() ?? entry;
    if (data?._id === parsed.id) return data;
  }
  return null;
}
