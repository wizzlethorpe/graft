// Building the packs, on the reader's machine, out of documents they already
// own plus the patches this module ships.
//
// Everything that decides *what* happens lives in patch.mjs and plan.mjs and
// is tested without Foundry. This file is the part that cannot be: resolving a
// UUID, unlocking a pack, writing a document.

import { applyPatch, expandSources, folderPath, folderSegments } from "./patch.mjs";
import { planOrder, entryUuid } from "./plan.mjs";

/**
 * Hydrate a module's entries into its own compendium packs.
 *
 * Its own, and not the world's, because chaining depends on it. What this
 * produces has to be addressable as `Compendium.<module>.<pack>.<Type>.<id>`
 * so somebody else's graft can name it; hydrating into `world.*` would give it
 * a UUID that means nothing outside this world and no chain could survive
 * leaving it.
 *
 * That has a cost: a module's packs are locked by default (`locked` falls back
 * to `packageType !== "world"`), so each one is unlocked for the write and put
 * back exactly as it was found. Leaving a pack unlocked because we happened to
 * write to it would quietly invite hand edits that the next hydration
 * overwrites.
 *
 * @returns a summary the caller can show: what was built, and what could not be.
 */
export async function hydrate(moduleId, entries, { onProgress } = {}) {
  const { order, invalid, cycles } = planOrder(entries, moduleId);
  const built = [];
  const skipped = [
    ...invalid.map(({ entry, reason }) => ({ id: entry?.id ?? "(no id)", reason })),
    ...cycles.map((loop) => ({ id: loop[0], reason: `grafts onto itself through ${loop.length - 1} other entries` })),
  ];

  const touched = new Map();   // collection -> the locked state we found it in
  try {
    for (const [i, entry] of order.entries()) {
      onProgress?.(i + 1, order.length, entry);
      try {
        built.push(await hydrateOne(entry, moduleId, touched));
      } catch (err) {
        // One unbuildable entry is not a reason to abandon the rest: a reader
        // missing one dependency should still get everything else.
        skipped.push({ id: entry.id, reason: err.message });
      }
    }
  } finally {
    await restoreLocks(touched);
    refreshSidebar(touched);
  }
  return { built, skipped };
}

/**
 * Resolve a UUID to plain document data.
 *
 * `.toObject()` is not optional: `fromUuid` returns a live Document, and the
 * patch functions walk what they are given. See `isPlainObject` in patch.mjs
 * for what goes wrong otherwise.
 */
async function resolveData(uuid) {
  const doc = await fromUuid(uuid);
  return doc ? doc.toObject() : null;
}

async function hydrateOne(entry, moduleId, touched) {
  // No source means the entry carries its own content, so there is nothing to
  // fetch and the patch is the document.
  let base = {};
  if (entry.source) {
    const source = await fromUuid(entry.source);
    if (!source) {
      // Almost always a dependency the reader has not installed. Foundry says
      // so better than we can, on the module's own listing, so name the UUID
      // and leave the diagnosis there.
      throw new Error(`source ${entry.source} did not resolve; is its module installed and enabled?`);
    }
    base = source.toObject();
  }

  const collection = `${moduleId}.${entry.pack}`;
  const pack = game.packs.get(collection);
  if (!pack) {
    // Foundry reads a module's manifest when the server starts, not when the
    // browser reloads, so a pack added to module.json is invisible until then.
    // That is the usual cause here and not an obvious one.
    const declared = [...game.packs.keys()].filter((c) => c.startsWith(`${moduleId}.`));
    throw new Error(
      `this module declares no pack "${entry.pack}". Foundry knows of `
      + `${declared.length ? declared.join(", ") : "none for this module"}. If you just added it to `
      + `module.json, restart the Foundry server: a browser reload does not re-read manifests.`,
    );
  }
  if (pack.documentName !== entry.type) {
    throw new Error(`pack "${entry.pack}" holds ${pack.documentName}, not ${entry.type}`);
  }
  await unlock(pack, touched);

  // Embedded entries that name a source are fetched first: a magic item added
  // to a statblock is a graft of its own, and the artifact carries a pointer
  // to it rather than a copy of its text.
  const patch = await expandSources(entry.patch ?? {}, resolveData);
  const data = applyPatch(base, patch);
  data._id = entry.id;
  // Rebuilt from names, since the source's folder id means nothing here.
  data.folder = await ensureFolderPath(pack, entry.folder);
  // Foundry's own provenance field, and the thing that makes the round trip
  // work later: an author who imports this and edits it can recover a patch
  // against what it was grafted from. Nothing to record for original content.
  if (entry.source) foundry.utils.setProperty(data, "_stats.compendiumSource", entry.source);

  const existing = await pack.getDocument(entry.id);
  if (existing) {
    await existing.update(data, { diff: false, recursive: false });
  } else {
    const cls = getDocumentClass(entry.type);
    await cls.create(data, { pack: collection, keepId: true, keepEmbeddedIds: true });
    // create() resolving is not proof of a document: Foundry reports a
    // validation failure to the GM and carries on, so the promise settles
    // either way and a caller counting successes would be wrong.
    if (!await pack.getDocument(entry.id)) {
      throw new Error("Foundry rejected the document; see the console for the validation error");
    }
  }
  return entryUuid(entry, moduleId);
}

/**
 * The folder an entry asks for, created in this pack if it is not there yet.
 *
 * Matched by name and parent rather than by a derived id, so a rebuild reuses
 * the folder somebody may have since renamed or recoloured, and an author who
 * organises a pack by hand does not have it undone on the next build.
 */
async function ensureFolderPath(pack, path) {
  let parent = null;
  for (const name of folderSegments(path)) {
    let folder = pack.folders.find((f) => f.name === name && (f.folder?.id ?? null) === parent);
    if (!folder) {
      try {
        folder = await Folder.create(
          { name, type: pack.documentName, folder: parent },
          { pack: pack.collection },
        );
      } catch (err) {
        // A document at the pack root is better than no document.
        console.warn(`Graft | could not create folder "${name}" in ${pack.collection}:`, err);
        return parent;
      }
    }
    parent = folder?.id ?? parent;
  }
  return parent;
}

async function unlock(pack, touched) {
  if (touched.has(pack.collection)) return;
  touched.set(pack.collection, pack.locked);
  if (pack.locked) await pack.configure({ locked: false });
}

/**
 * Show what was just built.
 *
 * The documents are written and readable at this point; this is only about the
 * sidebar, which lists a pack from its index. Re-rendering costs nothing and
 * saves someone concluding a successful build did nothing.
 */
function refreshSidebar(touched) {
  for (const collection of touched.keys()) {
    try { game.packs.get(collection)?.render(false); } catch { /* not open */ }
  }
  try { ui.compendium?.render(); } catch { /* sidebar not ready */ }
}

async function restoreLocks(touched) {
  for (const [collection, wasLocked] of touched) {
    if (!wasLocked) continue;
    try { await game.packs.get(collection)?.configure({ locked: true }); }
    catch (err) { console.warn(`Graft | could not re-lock ${collection}:`, err); }
  }
}

/**
 * The patch that turns a document's compendium source into the document as it
 * is now.
 *
 * The authoring half. Foundry stamps `_stats.compendiumSource` on anything
 * imported from a pack, so the source is already recorded and an author never
 * types a UUID: import somebody's monster, edit it in the ordinary sheet, and
 * this recovers what changed.
 */
export async function exportDiff(document) {
  const { diff, stripVolatile, referenceSources } = await import("./patch.mjs");
  const raw = document.toObject();
  // Read before stripping, because `compendiumSource` lives in the `_stats`
  // that stripping removes. This is what lets an added item be shipped as a
  // pointer instead of a copy.
  const sources = embeddedSources(raw);
  const mine = stripVolatile(raw);
  delete mine._id;

  // Carried as names so the other side can rebuild it. Kept even for a pure
  // reference, since organisation is most of what a bulk export is for.
  const folder = folderPath(document);
  const base = {
    id: document.id, type: document.documentName, ...(folder ? { folder } : {}),
  };
  const withRefs = async (patch) => referenceSources(patch, {
    sourceOf: (id) => sources.get(id) ?? null,
    resolve: resolveData,
  });

  const sourceUuid = document._stats?.compendiumSource;

  // Asked before the pack check, and the order matters. A document that graft
  // itself built lives in a pack *and* records what it was grafted from, so
  // testing for the pack first would export it as a reference to itself and
  // lose the graft entirely.
  //
  // With no such record, a document that lives in a compendium *is* a source.
  // There is nothing to diff it against, and the useful thing to say is
  // "include this", so it becomes a pure reference with an empty patch.
  if (!sourceUuid && document.pack) return { ...base, source: document.uuid, patch: {} };

  // Nothing to diff against, and that is not a failure: content the author
  // wrote is theirs, and a graft module is an adventure rather than only a
  // pile of derivatives. It travels whole, with no source.
  if (!sourceUuid) return { ...base, patch: await withRefs(mine) };

  const source = await fromUuid(sourceUuid);
  if (!source) {
    throw new Error(
      `${document.name} was imported from ${sourceUuid}, which no longer resolves. `
      + `Enable that module, or delete the document's compendiumSource to ship it whole.`,
    );
  }
  const before = stripVolatile(source.toObject());
  delete before._id;

  return { ...base, source: sourceUuid, patch: await withRefs(diff(before, mine) ?? {}) };
}

/**
 * Every embedded document's `_id` mapped to what it was imported from.
 *
 * Walks the raw object rather than the stripped one, since that is where
 * `_stats.compendiumSource` still is. Anything the author made themselves has
 * no entry here and is shipped whole, which is right: it is theirs.
 */
function embeddedSources(value, into = new Map()) {
  if (Array.isArray(value)) {
    for (const v of value) embeddedSources(v, into);
    return into;
  }
  if (!value || typeof value !== "object") return into;
  const source = value._stats?.compendiumSource;
  if (typeof value._id === "string" && typeof source === "string") into.set(value._id, source);
  for (const v of Object.values(value)) embeddedSources(v, into);
  return into;
}
