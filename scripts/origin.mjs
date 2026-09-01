// Where a document in this world actually came from.
//
// `_stats.compendiumSource` answers this well on the ordinary path, because
// `WorldCollection#fromCompendium` computes it from the pack being dragged out
// of. Adventure import does not call that function: it writes the embedded data
// with `keepId`, `_stats` and all, so a publisher's own stamp survives into
// your world, often naming a private work module nobody else can install.
//
// So graft records it at import, which is the one moment it is knowable.

const MODULE_ID = "graft";

/**
 * Stamp each document an adventure import is about to create or update.
 *
 * Both lists are plain data, by reference, before anything exists.
 * Deterministic ids mean a repeat import arrives in `toUpdate`.
 */
export function stampOrigin(adventure, toCreate, toUpdate) {
  const origin = { adventure: adventure.uuid, id: null };
  for (const batch of [toCreate, toUpdate]) {
    for (const documents of Object.values(batch ?? {})) {
      for (const data of documents ?? []) {
        // The id is recorded rather than inferred from `keepId` staying true.
        foundry.utils.setProperty(data, `flags.${MODULE_ID}.origin`, { ...origin, id: data._id });
      }
    }
  }
}

/** What we recorded, or null for anything imported before graft was watching. */
export function originOf(document) {
  const origin = document?.flags?.[MODULE_ID]?.origin;
  return origin?.adventure ? origin : null;
}

// An adventure's contents are embedded data, not documents, so they have no
// UUID and `fromUuid` cannot reach them. Knowing the adventure and the id,
// graft resolves one form of its own, written to read like the embedded UUIDs
// Foundry does support:
//
//   Compendium.<mod>.<pack>.Adventure.<advId>.JournalEntry.<docId>
//
// The only source graft resolves itself. The alternative was shipping
// somebody's entire adventure text inside a patch.

/** Adventure schema field per document type. */
const ADVENTURE_FIELDS = {
  Actor: "actors", Cards: "cards", Combat: "combats", Folder: "folders",
  Item: "items", JournalEntry: "journal", Macro: "macros",
  Playlist: "playlists", RollTable: "tables", Scene: "scenes",
};

const ADVENTURE_SOURCE =
  /^(Compendium\..+\.Adventure\.[a-zA-Z0-9]{16})\.([A-Za-z]+)\.([a-zA-Z0-9]{16})$/;

/** The source UUID for a document graft watched an adventure import. */
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
