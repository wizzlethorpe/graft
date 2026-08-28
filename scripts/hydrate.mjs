// Building the packs, on the reader's machine, out of documents they already
// own plus the patches this module ships.
//
// Everything that decides *what* happens lives in patch.mjs and plan.mjs and
// is tested without Foundry. This file is the part that cannot be: resolving a
// UUID, unlocking a pack, writing a document.

import { applyPatch, expandSources, folderPath, folderSegments } from "./patch.mjs";
import { originOf, adventureSourceUuid, resolveAdventureSource, parseAdventureSource } from "./origin.mjs";
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
  // Checked first, and not as a fallback. `fromUuid` does not return null for
  // this shape, it throws: it parses the tail and rejects JournalEntry as an
  // embedded document of Adventure, which is true and unhelpful. An adventure's
  // contents are embedded data rather than documents, which is the whole reason
  // graft resolves this one form itself.
  if (parseAdventureSource(uuid)) return resolveAdventureSource(uuid);
  const doc = await fromUuid(uuid);
  return doc ? doc.toObject() : null;
}

async function hydrateOne(entry, moduleId, touched) {
  // No source means the entry carries its own content, so there is nothing to
  // fetch and the patch is the document.
  let base = {};
  if (entry.source) {
    const source = await resolveData(entry.source);
    if (!source) {
      // Almost always a dependency the reader has not installed. Foundry says
      // so better than we can, on the module's own listing, so name the UUID
      // and leave the diagnosis there.
      throw new Error(`source ${entry.source} did not resolve; is its module installed and enabled?`);
    }
    base = source;
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
  if (entry.source) {
    const inAdventure = parseAdventureSource(entry.source);
    if (inAdventure) {
      // Not `_stats.compendiumSource`: Foundry cannot resolve this form, and
      // writing an unresolvable value there is the exact thing that started
      // all of this. Our own namespace round-trips instead.
      foundry.utils.setProperty(data, "flags.graft.origin",
        { adventure: inAdventure.adventure, id: inAdventure.id });
    } else {
      foundry.utils.setProperty(data, "_stats.compendiumSource", entry.source);
    }
  }

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
  // `isWhole` answers "is this array entry a complete document or just the
  // changed fields of one?" It is the caller's to answer because only the
  // caller has the base: a merge patch is shaped like the document it patches.
  const withRefs = async (patch, isWhole = () => true) => referenceSources(patch, {
    sourceOf: (id) => sources.get(id) ?? null,
    resolve: resolveData,
    isWhole,
  });

  // What we recorded at import beats what the document claims, because we
  // computed it from the adventure in front of us and the claim may have been
  // inherited from a publisher's private module. Falls back for anything
  // imported before graft was installed, and for the ordinary drag-from-a-pack
  // path where `fromCompendium` writes an accurate one anyway.
  const origin = originOf(document);
  // Prefer what we recorded: it points into an adventure the reader can own,
  // where the document's own claim points at a private work module.
  const sourceUuid = adventureSourceUuid(origin, document.documentName)
    ?? document._stats?.compendiumSource;

  // A document in a pack somebody else can install *is* a source, whatever it
  // remembers about its own past. Asked first, and the order is the whole point
  // of chaining: graft's own output lives in its module's packs, so pressing
  // Copy graft on a built document has to answer "reference this", not replay
  // the patch that produced it. That patch is in grafts.json, which is where it
  // belongs; re-deriving it here would mean nobody could ever graft onto a
  // graft, which is the case this format was shaped around.
  //
  // A *world* pack is the opposite: it is a workbench, not a distributable, and
  // referencing one would produce an entry no reader could resolve. So an
  // author who assembles a pack, drags in somebody's monster and edits it still
  // gets a real diff, which is what makes the bulk export worth having.
  const collection = document.pack ? game.packs.get(document.pack) : null;
  if (collection && collection.metadata?.packageType !== "world") {
    return { ...base, source: document.uuid, patch: {} };
  }

  // Nothing to diff against, and that is not a failure: content the author
  // wrote is theirs, and a graft module is an adventure rather than only a
  // pile of derivatives. It travels whole, with no source.
  if (!sourceUuid) return { ...base, patch: await withRefs(mine) };

  const source = await resolveData(sourceUuid);
  if (!source) {
    // Two very different situations, and only one is the author's to fix.
    const pkg = sourceUuid.split(".")[1];
    const installed = game.modules.get(pkg) ?? (game.system.id === pkg ? game.system : null);
    if (installed) {
      throw new Error(
        `${document.name} was imported from ${sourceUuid}. ${installed.title ?? pkg} is installed `
        + `but not enabled, so the source cannot be read. Enable it and copy again.`,
      );
    }
    // Not installed at all, and quite possibly unpublishable: publishers build
    // in a private work module and Foundry stamps its id on everything, then
    // adventure import carries the stamp into your world. Nobody outside that
    // studio can resolve it, so "enable the module" is not advice.
    //
    // Treated as no recorded source, which is a case with settled meaning: a
    // document in a pack references itself, and one in the world travels whole.
    // Travelling whole means the content is in your grafts.json, which is
    // visible in the file and is the author's call to make.
    // Knowing where it really came from improves what we can say, and nothing
    // else: an outcome that got worse the more we knew would be a strange
    // thing to build.
    const from = origin ? (await fromUuid(origin.adventure))?.name ?? origin.adventure : null;
    console.warn(
      `Graft | ${document.name} records ${sourceUuid} as its source, but ${pkg} is not installed`
      + (from
        ? `. It came from the adventure ${from}, and ${pkg} is that publisher's own work module, `
          + `which was never released. An adventure's contents have no UUID of their own, so there `
          + `is nothing to point at.`
        : `, and was most likely a publisher's private work module.`)
      + ` Exporting with no source, so this entry carries its content: check you may distribute it.`,
    );
    if (document.pack) return { ...base, source: document.uuid, patch: {} };
    return { ...base, patch: await withRefs(mine) };
  }
  const before = stripVolatile(source);
  delete before._id;

  // Only entries `diff` had no prior for are whole; the rest are deltas against
  // one. Referencing a delta would diff it against the full source and null out
  // every field it did not mention.
  const whole = new Set();
  const delta = diff(before, mine, whole) ?? {};
  return { ...base, source: sourceUuid, patch: await withRefs(delta, (id) => whole.has(id)) };
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
