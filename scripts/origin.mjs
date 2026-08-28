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
