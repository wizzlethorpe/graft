// Building packs on the reader's machine, from documents they already own plus
// the patches this module ships.
//
// What happens is decided in patch.mjs and plan.mjs, which are tested without
// Foundry. This file is the part that cannot be: resolving a UUID, unlocking a
// pack, writing a document.

import {
  applyPatch, currentWorld, diff, driftFromSource, driftWarnings, expandSources,
  folderPath, folderSegments, referenceSources, sourceHash, stripVolatile,
} from "./patch.mjs";
import {
  originOf, adventureSourceUuid, resolveAdventureSource, parseAdventureSource,
} from "./origin.mjs";
import { planOrder, entryUuid, adventureId, sourcesOf } from "./plan.mjs";
import { rewriteEntry } from "./extend.mjs";
import { adventurePacks } from "./modules.mjs";
import { MEMBER_FIELDS, assembleAdventure, adventureFolderOf, membersOf } from "./assemble.mjs";

/**
 * Hydrate a module's entries into its own compendium packs.
 *
 * Its own packs, not the world's, because the result has to be addressable as
 * `Compendium.<module>.<pack>.<Type>.<id>` for anything to graft onto it. A
 * pack declared as an Adventure gets one Adventure holding every entry aimed
 * at it, each addressable as `Compendium.<module>.<pack>.Adventure.<advId>.<Type>.<id>`.
 *
 * Module packs are locked by default, so each is unlocked for the write and put
 * back as it was found: leaving one unlocked invites hand edits that the next
 * build overwrites.
 *
 * @returns `{ built, skipped, warnings, removed }`, all reportable.
 */
export async function hydrate(moduleId, entries, { onProgress, declared = entries } = {}) {
  const adventures = adventurePacks(moduleId, entries);
  const { order, invalid, cycles } = planOrder(entries, moduleId, adventures);
  const declaredIds = idsByPack([...declared, ...entries]);
  const built = [];
  const warnings = [];
  const skipped = [
    ...invalid.map(({ entry, reason }) => ({ id: entry?.id ?? "(no id)", reason })),
    ...cycles.map((loop) => ({ id: loop[0].split(".").pop(), reason: `grafts onto itself through ${loop.length - 2} other entries` })),
  ];

  const touched = new Map();   // collection -> its whole prior config entry
  // uuid -> data this build produced. A sibling inside an Adventure is never
  // written on its own, so it can only be resolved from here.
  const produced = new Map();
  const resolve = async (uuid) => produced.get(uuid) ?? resolveData(uuid);
  const members = new Map([...adventures].map((pack) => [pack, []]));
  const ctx = { touched, warnings, resolve, adventures, produced, members };
  let removed = [];
  try {
    for (const [i, entry] of order.entries()) {
      onProgress?.(i + 1, order.length, entry);
      try {
        const uuid = await hydrateOne(entry, moduleId, ctx);
        if (uuid) built.push(uuid);
      } catch (err) {
        // A reader missing one dependency should still get everything else.
        skipped.push({ id: entry.id, reason: err.message });
      }
    }
    for (const [pack, list] of members) {
      if (list.length === 0) continue;
      try {
        await writeAdventure(moduleId, pack, list, declaredIds.get(pack), touched);
        built.push(...list.map((m) => m.uuid));
      } catch (err) {
        skipped.push(...list.map((m) => ({ id: m.id, reason: `its Adventure could not be written: ${err.message}` })));
      }
    }
    removed = await pruneStale(moduleId, declaredIds, touched);
  } finally {
    await restoreLocks(touched);
    refreshSidebar(touched);
  }
  return { built, skipped, warnings, removed };
}

/**
 * Delete what graft built for entries that no longer exist.
 *
 * Dropping an entry from `grafts.json` would otherwise leave what it built in
 * the reader's pack for good, and a shipped update could never retract
 * anything.
 *
 * Only documents graft built are eligible: `flags.graft.built` is written on
 * every one, so a document an author added to the pack by hand is never
 * touched. Anything unbuildable this run is left alone too, since a reader
 * missing a dependency should not have working content deleted.
 */
async function pruneStale(moduleId, declaredIds, touched) {
  const removed = [];
  for (const [name, ids] of declaredIds) {
    const pack = game.packs.get(`${moduleId}.${name}`);
    if (!pack) continue;
    // From the pack, not from this run's entries: a transform that dropped
    // every entry of an Adventure pack must not make its Adventure stale.
    const wanted = pack.documentName === "Adventure" ? new Set([adventureId(moduleId, name)]) : ids;
    let index;
    try {
      index = await pack.getIndex({ fields: ["flags.graft.built"] });
    } catch {
      continue;                             // an index we cannot read is not one to delete from
    }
    const stale = index.filter((e) => e?.flags?.graft?.built && !wanted.has(e._id));
    if (stale.length === 0) continue;

    await unlock(pack, touched);
    for (const doc of stale) {
      try {
        const d = await pack.getDocument(doc._id);
        if (!d) continue;
        await d.delete();
        removed.push({ id: doc._id, name: doc.name ?? doc._id, pack: name });
      } catch (err) {
        console.warn(`Graft | could not remove stale ${doc._id} from ${pack.collection}:`, err);
      }
    }
  }
  return removed;
}

/** Entry ids per pack. */
function idsByPack(entries) {
  const out = new Map();
  for (const entry of entries) {
    if (!entry?.pack || !entry?.id) continue;
    if (!out.has(entry.pack)) out.set(entry.pack, new Set());
    out.get(entry.pack).add(entry.id);
  }
  return out;
}

/**
 * Resolve a UUID to plain document data.
 *
 * The adventure form is checked first because `fromUuid` throws on it rather
 * than returning null: it rejects `JournalEntry` as an embedded document of
 * `Adventure`, which is true, and is exactly why graft resolves it itself.
 *
 * `.toObject()` is not optional; see `isPlainObject` in patch.mjs.
 */
async function resolveData(uuid) {
  const fromAdventure = await resolveAdventureSource(uuid);
  if (fromAdventure !== null) return fromAdventure;
  const doc = await fromUuid(uuid);
  return doc ? doc.toObject() : null;
}

async function hydrateOne(entry, moduleId, { touched, warnings, resolve, adventures, produced, members }) {
  // No source means the entry carries its own content: the patch is the document.
  let base = {};
  let source = null;
  const candidates = sourcesOf(entry);
  if (candidates.length > 0) {
    // First that resolves. A list lets an author prefer better content without
    // requiring it, so exhausting the list is the failure, not missing the
    // first one.
    for (const candidate of candidates) {
      const data = await resolve(candidate);
      if (data) { base = data; source = candidate; break; }
    }
    if (!source) {
      throw new Error(candidates.length === 1
        ? `source ${candidates[0]} did not resolve; is its module installed and enabled?`
        : `none of ${candidates.length} sources resolved: ${candidates.join(", ")}`);
    }
    warnings.push(...driftWarnings(entry.id, base, currentWorld()));
    // Only when one source was named. A hash is recorded against the document
    // an author diffed, and a list does not say which of them that was.
    if (candidates.length === 1) {
      const changed = driftFromSource(entry.id, entry.sourceHash, stripVolatile(base), entry.patch ?? {});
      if (changed) warnings.push(changed);
    }
  }

  const collection = `${moduleId}.${entry.pack}`;
  const pack = game.packs.get(collection);
  if (!pack) {
    // Usually a pack added to module.json since the server last started, since
    // manifests are read at startup and not on browser reload.
    const declared = [...game.packs.keys()].filter((c) => c.startsWith(`${moduleId}.`));
    throw new Error(
      `this module declares no pack "${entry.pack}". Foundry knows of `
      + `${declared.length ? declared.join(", ") : "none for this module"}. If you just added it to `
      + `module.json, restart the Foundry server: a browser reload does not re-read manifests.`,
    );
  }
  const assembled = adventures.has(entry.pack);
  if (assembled) {
    if (!MEMBER_FIELDS[entry.type]) {
      throw new Error(`pack "${entry.pack}" is an Adventure, which has nowhere to put a ${entry.type}`);
    }
  } else if (pack.documentName !== entry.type) {
    throw new Error(`pack "${entry.pack}" holds ${pack.documentName}, not ${entry.type}`);
  }
  if (!assembled) await unlock(pack, touched);

  const patch = await expandSources(entry.patch ?? {}, resolve);
  const data = applyPatch(base, patch);
  data._id = entry.id;
  data.folder = assembled
    ? adventureFolderOf(moduleId, entry.pack, entry)
    : await ensureFolderPath(pack, entry.folder);
  recordSource(data, source);

  const cls = getDocumentClass(entry.type);
  // fromImport is Foundry's own migration path; skipping it lands v13 data
  // under v14 semantics.
  let prepared;
  try {
    prepared = (await cls.fromImport(data)).toObject();
  } catch (err) {
    try {
      prepared = new cls(data, { pack: collection }).toObject();
      warnings.push({ id: entry.id, reason: `Foundry could not import this (${err.message}); built without migrating, so parts of it may be missing` });
    } catch (invalid) {
      throw new Error(summarizeValidation(invalid));
    }
  }
  prepared._id = entry.id;   // `fromImport` is free to assign its own

  const uuid = entryUuid(entry, moduleId, adventures);
  if (assembled) {
    members.get(entry.pack).push({ id: entry.id, uuid, type: entry.type, folder: entry.folder, data: prepared });
  } else {
    await writeDocument(pack, cls, collection, prepared);
  }
  // After the write, so a sibling never builds on a document Foundry rejected.
  produced.set(uuid, prepared);
  return assembled ? null : uuid;
}

/** Create or update one document in a pack, only if it would change. */
async function writeDocument(pack, cls, collection, prepared) {
  // What makes a document reclaimable later. Without it, pruning could not tell
  // graft's output from something an author put in the pack by hand.
  foundry.utils.setProperty(prepared, "flags.graft.built", true);
  const existing = await pack.getDocument(prepared._id);
  if (existing) {
    // A write Foundry would turn into the document already there costs a
    // quarter-second of pack index and disk for no change, and most entries
    // are unchanged on most rebuilds. Compared rather than remembered: a
    // stored digest would go stale against a Foundry upgrade migrating the
    // same input differently, or against an edit made in the pack by hand.
    if (!identical(prepared, existing.toObject())) {
      await existing.update(prepared, { diff: false, recursive: false });
    }
  } else {
    await cls.create(prepared, { pack: collection, keepId: true, keepEmbeddedIds: true });
    if (!await pack.getDocument(prepared._id)) {
      throw new Error("Foundry rejected the document; see the console for the reason");
    }
  }
}

/**
 * Fold a pack's members into its one Adventure and write it.
 *
 * Constructed rather than imported: `Adventure.fromImport` migrates through a
 * world collection Adventures do not have, and the members are already
 * migrated through their own classes.
 *
 * A declared member this run did not produce keeps its place from the
 * existing Adventure, as an unbuilt entry keeps its document in an ordinary
 * pack. Only an entry no longer declared is dropped.
 */
async function writeAdventure(moduleId, packName, members, declaredIds, touched) {
  const collection = `${moduleId}.${packName}`;
  const pack = game.packs.get(collection);
  await unlock(pack, touched);

  const existing = await pack.getDocument(adventureId(moduleId, packName));
  const fresh = new Set(members.map((m) => m.id));
  const kept = existing
    ? membersOf(existing.toObject()).filter((m) => declaredIds.has(m.id) && !fresh.has(m.id))
    : [];
  const data = assembleAdventure(moduleId, packName, pack.metadata, [...members, ...kept]);

  const cls = getDocumentClass("Adventure");
  let prepared;
  try {
    prepared = new cls(data, { pack: collection }).toObject();
  } catch (invalid) {
    throw new Error(summarizeValidation(invalid));
  }
  await writeDocument(pack, cls, collection, prepared);
}

/** Written afresh by Foundry on every save, so never a real difference. */
const RESAVED = new Set(["modifiedTime", "lastModifiedBy"]);

/** Key order is not a difference; two schemas can emit the same data either way. */
function ordered(value) {
  if (Array.isArray(value)) return value.map(ordered);
  if (!value || typeof value !== "object" || Object.getPrototypeOf(value) !== Object.prototype) return value;
  const out = {};
  for (const k of Object.keys(value).sort()) out[k] = ordered(value[k]);
  return out;
}

/** Whether writing `prepared` over `existing` would leave anything different. */
export function identical(prepared, existing) {
  const settled = ({ _stats, ...rest }) => ordered(_stats && typeof _stats === "object"
    ? { ...rest, _stats: Object.fromEntries(Object.entries(_stats).filter(([k]) => !RESAVED.has(k))) }
    : rest);
  return JSON.stringify(settled(prepared)) === JSON.stringify(settled(existing));
}

/**
 * A validation failure in one line rather than eighty.
 *
 * Foundry reports one failure per element, so a scene whose walls were authored
 * for an older schema produces the same message eighty times over. The useful
 * content is the field, the reason, and how many, which is what a reader needs
 * to decide whether it is their problem.
 */
export function summarizeValidation(err) {
  const raw = String(err?.message ?? err);
  const counts = new Map();
  let field = null;
  for (const line of raw.split("\n")) {
    const text = line.trim();
    if (!text) continue;
    const named = /^([A-Za-z_][\w.]*): \w+#_validateRecursive$/.exec(text);
    if (named) { field = named[1]; continue; }
    if (/_validateRecursive$/.test(text)) continue;      // the root, and array indices
    const key = field ? `${field}: ${text}` : text;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  if (counts.size === 0) return raw.slice(0, 200);
  return [...counts].map(([k, n]) => (n > 1 ? `${k} (×${n})` : k)).join("; ");
}

/**
 * Note what this was grafted from, so an author who imports and edits it can
 * recover a patch later.
 *
 * The adventure form goes in our own flags rather than `_stats.compendiumSource`,
 * which Foundry cannot resolve.
 */
function recordSource(data, source) {
  if (!source) return;
  const inAdventure = parseAdventureSource(source);
  if (inAdventure) {
    foundry.utils.setProperty(data, "flags.graft.origin",
      { adventure: inAdventure.adventure, id: inAdventure.id });
  } else {
    foundry.utils.setProperty(data, "_stats.compendiumSource", source);
  }
}

/**
 * The folder an entry asks for, created in this pack if absent.
 *
 * Matched by name and parent rather than a derived id, so a folder somebody
 * renamed or recoloured by hand survives the next build.
 */
async function ensureFolderPath(pack, path) {
  let parent = null;
  for (const name of folderSegments(path)) {
    let folder = pack.folders.find((f) => f.name === name && (f.folder?.id ?? null) === parent);
    if (!folder) {
      try {
        folder = await Folder.create({ name, type: pack.documentName, folder: parent }, { pack: pack.collection });
      } catch (err) {
        // A document at the pack root beats no document.
        console.warn(`Graft | could not create folder "${name}" in ${pack.collection}:`, err);
        return parent;
      }
    }
    parent = folder?.id ?? parent;
  }
  return parent;
}

const PACK_CONFIG = "compendiumConfiguration";

/**
 * Unlock a pack for writing, remembering its whole configuration entry.
 *
 * The entry, not just `locked`. `configure` writes the pack's full current
 * state, so unlocking a pack that had no entry creates one containing
 * `folder: null`, and an explicit null in world config beats the `packFolders`
 * declared in a manifest. Building a module once would permanently unfile its
 * own packs.
 */
async function unlock(pack, touched) {
  if (touched.has(pack.collection)) return;
  const config = game.settings.get("core", PACK_CONFIG) ?? {};
  const prior = config[pack.collection];
  touched.set(pack.collection, prior ? { ...prior } : null);
  if (pack.locked) await pack.configure({ locked: false });
}

/** Put every entry back exactly as it was found, including not existing. */
async function restoreLocks(touched) {
  if (touched.size === 0) return;
  try {
    const config = { ...game.settings.get("core", PACK_CONFIG) };
    for (const [collection, prior] of touched) {
      if (prior) config[collection] = prior;
      else delete config[collection];
    }
    await game.settings.set("core", PACK_CONFIG, config);
  } catch (err) {
    console.warn("Graft | could not restore pack configuration:", err);
  }
}

/** The sidebar lists a pack from its index, so it needs telling. */
function refreshSidebar(touched) {
  for (const collection of touched.keys()) {
    try { game.packs.get(collection)?.render(false); } catch { /* not open */ }
  }
  try { ui.compendium?.render(); } catch { /* sidebar not ready */ }
}

/**
 * The graft entry describing a document as it is now.
 *
 * The authoring half, and the reason nobody types a UUID: Foundry records where
 * a document was imported from, so importing a monster, editing it in the
 * ordinary sheet, and pressing Copy graft recovers what changed.
 *
 * A module that fetched the source gets the last word on how it is named.
 */
export async function exportDiff(document) {
  return rewriteEntry(await diffEntry(document), document);
}

async function diffEntry(document) {
  const raw = document.toObject();
  // Read before stripping: `compendiumSource` lives in the `_stats` it removes.
  const sources = embeddedSources(raw);
  const mine = stripVolatile(raw);
  delete mine._id;

  const folder = folderPath(document);
  const base = { id: document.id, type: document.documentName, ...(folder ? { folder } : {}) };
  const withRefs = (patch, isWhole = () => true) => referenceSources(patch, {
    sourceOf: (id) => sources.get(id) ?? null,
    resolve: resolveData,
    isWhole,
  });

  // A document in a pack anyone can install *is* a source, whatever it
  // remembers. Asked first, because graft's own output lives in module packs
  // and Copy graft on a built document must answer "reference this" for
  // chaining to work. A world pack is a workbench rather than a distributable,
  // so documents there are diffed instead.
  const pack = document.pack ? game.packs.get(document.pack) : null;
  if (pack && pack.metadata?.packageType !== "world") {
    return { ...base, source: document.uuid, patch: {} };
  }

  // What graft recorded at import beats what the document claims: the claim can
  // be inherited from a publisher's private work module, where ours points at
  // an adventure the reader can own.
  const origin = originOf(document);
  const sourceUuid = adventureSourceUuid(origin, document.documentName)
    ?? document._stats?.compendiumSource;

  // Content the author wrote is theirs, and travels whole.
  if (!sourceUuid) return { ...base, patch: await withRefs(mine) };

  const source = await resolveData(sourceUuid);
  if (!source) {
    reportUnresolvedSource(document, sourceUuid, origin);
    return { ...base, patch: await withRefs(mine) };
  }

  const before = stripVolatile(source);
  delete before._id;
  // Only entries with no prior are whole; referencing a delta would diff it
  // against the full source and null out every field it did not mention.
  const whole = new Set();
  const delta = diff(before, mine, whole) ?? {};
  const patch = await withRefs(delta, (id) => whole.has(id));
  // Only when there is something to have drifted. A pure reference patches
  // nothing, so its hash would be the same constant on every entry.
  const hash = Object.keys(patch).length > 0 ? { sourceHash: sourceHash(before, patch) } : {};
  return { ...base, source: sourceUuid, ...hash, patch };
}

/**
 * Explain a source that did not resolve, and throw if the reader can fix it.
 *
 * Installed but disabled is theirs to fix. Not installed at all may be nobody's
 * to fix: publishers build in a private work module, Foundry stamps its id on
 * every document, and adventure import carries the stamp into your world. Then
 * the document travels whole, which puts the content in your grafts.json.
 */
function reportUnresolvedSource(document, sourceUuid, origin) {
  const pkg = sourceUuid.split(".")[1];
  const installed = game.modules.get(pkg) ?? (game.system.id === pkg ? game.system : null);
  if (installed) {
    throw new Error(
      `${document.name} was imported from ${sourceUuid}. ${installed.title ?? pkg} is installed `
      + `but not enabled, so the source cannot be read. Enable it and copy again.`,
    );
  }
  const from = origin ? game.packs.get(origin.adventure.split(".").slice(1, 3).join("."))?.title : null;
  console.warn(
    `Graft | ${document.name} records ${sourceUuid} as its source, but ${pkg} is not installed`
    + (from ? `. It came from ${from}, and ${pkg} is that publisher's own work module.` : "")
    + ` Exporting with no source, so this entry carries its content: check you may distribute it.`,
  );
}

/**
 * Every embedded document's `_id` mapped to what it was imported from.
 *
 * Walks the raw object, since that is where `_stats.compendiumSource` still is.
 */
function embeddedSources(value, into = new Map()) {
  if (Array.isArray(value)) {
    for (const v of value) embeddedSources(v, into);
  } else if (value && typeof value === "object") {
    const source = value._stats?.compendiumSource;
    if (typeof value._id === "string" && typeof source === "string") into.set(value._id, source);
    for (const v of Object.values(value)) embeddedSources(v, into);
  }
  return into;
}
