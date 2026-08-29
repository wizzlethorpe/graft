// Building packs on the reader's machine, from documents they already own plus
// the patches this module ships.
//
// What happens is decided in patch.mjs and plan.mjs, which are tested without
// Foundry. This file is the part that cannot be: resolving a UUID, unlocking a
// pack, writing a document.

import {
  applyPatch, diff, expandSources, folderPath, folderSegments,
  referenceSources, stripVolatile,
} from "./patch.mjs";
import {
  originOf, adventureSourceUuid, resolveAdventureSource, parseAdventureSource,
} from "./origin.mjs";
import { planOrder, entryUuid } from "./plan.mjs";

/**
 * Hydrate a module's entries into its own compendium packs.
 *
 * Its own packs, not the world's, because the result has to be addressable as
 * `Compendium.<module>.<pack>.<Type>.<id>` for anything to graft onto it.
 *
 * Module packs are locked by default, so each is unlocked for the write and put
 * back as it was found: leaving one unlocked invites hand edits that the next
 * build overwrites.
 *
 * @returns `{ built, skipped, warnings }`, all reportable to the reader.
 */
export async function hydrate(moduleId, entries, { onProgress } = {}) {
  const { order, invalid, cycles } = planOrder(entries, moduleId);
  const built = [];
  const warnings = [];
  const skipped = [
    ...invalid.map(({ entry, reason }) => ({ id: entry?.id ?? "(no id)", reason })),
    ...cycles.map((loop) => ({ id: loop[0], reason: `grafts onto itself through ${loop.length - 1} other entries` })),
  ];

  const touched = new Map();   // collection -> its whole prior config entry
  try {
    for (const [i, entry] of order.entries()) {
      onProgress?.(i + 1, order.length, entry);
      try {
        built.push(await hydrateOne(entry, moduleId, touched, warnings));
      } catch (err) {
        // A reader missing one dependency should still get everything else.
        skipped.push({ id: entry.id, reason: err.message });
      }
    }
  } finally {
    await restoreLocks(touched);
    refreshSidebar(touched);
  }
  return { built, skipped, warnings };
}

/**
 * The Foundry generation a document was authored for, or null.
 *
 * `_stats.coreVersion` is recorded on anything Foundry has written, and is the
 * one piece of `_stats` that says something about the document rather than
 * about this copy of it.
 */
export function authoredGeneration(data) {
  const major = Number(String(data?._stats?.coreVersion ?? "").split(".")[0]);
  return Number.isInteger(major) && major > 0 ? major : null;
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
  if (parseAdventureSource(uuid)) return resolveAdventureSource(uuid);
  const doc = await fromUuid(uuid);
  return doc ? doc.toObject() : null;
}

async function hydrateOne(entry, moduleId, touched, warnings = []) {
  // No source means the entry carries its own content: the patch is the document.
  let base = {};
  if (entry.source) {
    base = await resolveData(entry.source);
    if (!base) {
      throw new Error(`source ${entry.source} did not resolve; is its module installed and enabled?`);
    }
    // Fields that moved between generations do not carry over, and the failure
    // is not always loud: a pre-14 scene keeps a `background` nothing reads any
    // more, and builds looking fine. Said before the build rather than after.
    const authored = authoredGeneration(base);
    const current = Number(game.release?.generation);
    if (authored && current && authored < current) {
      warnings.push({ id: entry.id,
        reason: `authored for Foundry ${authored}, and this is ${current}: fields that moved since will not carry over` });
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
  if (pack.documentName !== entry.type) {
    throw new Error(`pack "${entry.pack}" holds ${pack.documentName}, not ${entry.type}`);
  }
  await unlock(pack, touched);

  const patch = await expandSources(entry.patch ?? {}, resolveData);
  const data = applyPatch(base, patch);
  data._id = entry.id;
  data.folder = await ensureFolderPath(pack, entry.folder);
  recordSource(data, entry.source);

  const existing = await pack.getDocument(entry.id);
  if (existing) {
    await existing.update(data, { diff: false, recursive: false });
  } else {
    const cls = getDocumentClass(entry.type);
    // Validated by constructing first, because `create` does not throw on a
    // validation failure: it reports to the GM and carries on, so the reason
    // would never reach the build report. Same validation, and this one throws.
    try {
      new cls(data, { pack: collection });
    } catch (err) {
      throw new Error(summarizeValidation(err));
    }
    await cls.create(data, { pack: collection, keepId: true, keepEmbeddedIds: true });
    if (!await pack.getDocument(entry.id)) {
      throw new Error("Foundry rejected the document; see the console for the reason");
    }
  }
  return entryUuid(entry, moduleId);
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
 */
export async function exportDiff(document) {
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
  return { ...base, source: sourceUuid, patch: await withRefs(delta, (id) => whole.has(id)) };
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
