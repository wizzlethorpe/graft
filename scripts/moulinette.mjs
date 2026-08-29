// Resolving `@moulinette/...` against the reader's own Moulinette library.
//
// Composition without redistribution, which is graft's whole argument extended
// to a cloud: an entry points at The MAD Cartographer's map or Michael Ghelfi's
// ambience, ships neither, and each reader's own subscriptions decide what they
// get.
//
//   @moulinette/<pack_ref>/<filepath>
//   @moulinette/10698/scenes/abandoned-mine-entrance.webp
//
// `pack_ref` is the number in a marketplace URL. The two slugs beside it there
// are display names run through `.slugify()`, so they change when a creator
// renames a pack; the number does not.
//
// Two shapes. As an entry's `source` it names a *document*, which is fetched,
// patched, and returned as a sourceless entry carrying the result: no pack of
// graft's own, no ids to collide. Anywhere inside a patch it names a *file*,
// which is downloaded and rewritten to a local path.

import { applyPatch, stripVolatile } from "./patch.mjs";
import * as progress from "./progress.mjs";

export const MOULINETTE_PREFIX = "@moulinette/";

/** The collection that fetches `/all-assets`: the reader's whole entitled index. */
const CACHED_COLLECTION = "mou-cloud-cached";

export function isMoulinetteRef(v) {
  return typeof v === "string" && v.startsWith(MOULINETTE_PREFIX);
}

/**
 * `{ pack, file }`, or null. The file segment keeps its slashes, since creators
 * nest folders inside a pack.
 */
export function parseRef(s) {
  if (!isMoulinetteRef(s)) return null;
  const [pack, ...rest] = s.slice(MOULINETTE_PREFIX.length).split("/");
  const file = rest.join("/");
  return pack && file ? { pack, file } : null;
}

/**
 * Rewrite every reference reachable from `value`, dropping what cannot resolve.
 *
 * A node that *directly* loses a key is no longer viable: a playlist sound with
 * no `path` is worse than no sound, and a `background` with no `src` is worse
 * than no background, so the parent drops it. That propagates exactly one
 * level, or one missing ambience would discard a whole scene.
 *
 * Pure, with resolution injected, so the walk is testable without Foundry.
 *
 * @returns `{ value, viable }`
 */
export async function rewriteRefs(node, resolve) {
  if (Array.isArray(node)) {
    const out = [];
    for (const item of node) {
      if (isMoulinetteRef(item)) {
        const path = await resolve(item);
        if (path) out.push(path);
        continue;
      }
      const r = await rewriteRefs(item, resolve);
      if (r.viable) out.push(r.value);
    }
    return { value: out, viable: true };
  }
  if (node && typeof node === "object" && Object.getPrototypeOf(node) === Object.prototype) {
    const out = {};
    let viable = true;
    for (const [key, v] of Object.entries(node)) {
      if (isMoulinetteRef(v)) {
        const path = await resolve(v);
        if (path) out[key] = path;
        else viable = false;
        continue;
      }
      const r = await rewriteRefs(v, resolve);
      if (r.viable) out[key] = r.value;
    }
    return { value: out, viable };
  }
  return { value: node, viable: true };
}

/**
 * The reader's asset index, or a reason it is unavailable.
 *
 * `collections` and `cache` are not a public API, so this checks for what it
 * needs rather than assuming it. Each failure says whose problem it is: not
 * installed and not signed in are the reader's, and differently; a changed
 * internal is ours.
 */
async function loadIndex() {
  const mod = game.modules?.get("moulinette");
  if (!mod) return { error: "the Moulinette module is not installed" };
  if (!mod.active) return { error: "Moulinette is installed but not enabled in this world" };
  if (!mod.getSessionId?.()) {
    return { error: "you are not signed in to Moulinette; sign in and build again" };
  }

  const collection = mod.collections?.find((c) => c.getId?.() === CACHED_COLLECTION);
  if (!collection?.initialize || !collection.selectAsset || !collection.downloadAsset) {
    return { error: "Moulinette's asset index is not where graft expects it; this needs updating" };
  }
  try {
    await collection.initialize();          // populates cache.allAssets; warm after the first
  } catch (err) {
    return { error: `could not load your Moulinette index: ${err?.message ?? err}` };
  }
  // No contract on this shape, and a non-array reaching `.find()` throws.
  const assets = mod.cache?.allAssets;
  if (!Array.isArray(assets)) {
    return { error: "Moulinette's asset index is not a list; this needs updating" };
  }
  return { mod, collection, assets };
}

/** `pack_ref` plus filepath names exactly one asset, so an exact match is right. */
function findAsset(ref, index) {
  return index.assets.find((a) => String(a?.pack_id) === ref.pack && a?.url === ref.file) ?? null;
}

/** Where a media asset landed locally, or throws with a reason. */
async function downloadMedia(ref, index) {
  const asset = findAsset(ref, index);
  if (!asset) {
    throw new Error(`no ${ref.file} in Moulinette pack ${ref.pack}: your account may not include it, or it moved`);
  }
  const path = await index.collection.selectAsset(asset);
  if (!path) throw new Error(`${ref.pack}/${ref.file} is a document, not a file, so it cannot be a path`);
  return path;
}

/**
 * Document data for a `.json` asset.
 *
 * Not `selectAsset`, which returns the containing folder for these. The
 * document comes back as `message`, with its `#DEP#` placeholders rewritten to
 * wherever its dependencies just landed, which is why this is slow: a scene
 * pulls its map, tiles and ambience with it.
 */
async function downloadDocument(ref, index) {
  const asset = findAsset(ref, index);
  if (!asset) {
    throw new Error(`no ${ref.file} in Moulinette pack ${ref.pack}: your account may not include it, or it moved`);
  }
  const descriptor = await index.mod.cloudclient.apiGET(`/asset/${asset.id}`, {
    session: index.mod.getSessionId(),
  });
  const dl = await index.collection.downloadAsset(descriptor);
  if (!dl?.message) throw new Error(`${ref.pack}/${ref.file} is a file, not a document`);
  return JSON.parse(dl.message);
}

/** The provider graft registers when Moulinette is present. */
export function moulinetteProvider() {
  return { id: "moulinette", label: "Moulinette", hydrate: hydrateEntries };
}

async function hydrateEntries(entries) {
  const wanted = entries.some((e) => isMoulinetteRef(e?.source) || mentionsRef(e?.patch));
  if (!wanted) return null;

  const index = await loadIndex();
  if (index.error) {
    // One reason, not one per entry: a reader who is not signed in does not
    // need to be told forty times.
    throw new Error(index.error);
  }

  const files = new Map();      // reference -> local path, or null
  const skipped = [];
  const out = [];

  // The provider knows its own unit of work better than the loop that called
  // it, so it names the phase rather than taking a generic one.
  progress.phase("Moulinette", entries.length);
  for (const entry of entries) {
    progress.step(entry.id);
    const problems = [];
    const resolve = async (ref) => {
      if (files.has(ref)) return files.get(ref);
      let path = null;
      const parsed = parseRef(ref);
      if (!parsed) problems.push(`malformed reference ${ref}`);
      else {
        try {
          // A download takes seconds and is invisible from the entry loop.
          progress.note(parsed.file.split("/").pop());
          path = await downloadMedia(parsed, index);
        }
        catch (err) { problems.push(err.message); }
      }
      files.set(ref, path);
      return path;
    };

    let next = entry;
    if (isMoulinetteRef(entry.source)) {
      const parsed = parseRef(entry.source);
      if (!parsed) {
        skipped.push({ id: entry.id, reason: `malformed source ${entry.source}` });
        continue;
      }
      let document;
      try {
        // Slow: a scene pulls its map, tiles and ambience with it.
        progress.note(parsed.file.split("/").pop());
        document = await downloadDocument(parsed, index);
      } catch (err) {
        skipped.push({ id: entry.id, reason: err.message });
        continue;
      }
      // The patch applied to the fetched JSON, carried whole with no source.
      // `hydrateOne` already treats a missing source as "the patch is the
      // document", so this needs nothing new from the builder.
      const patch = applyPatch(stripVolatile(document), entry.patch ?? {});
      // A blank source would otherwise lose the trail entirely.
      patch.flags = { ...patch.flags, graft: { ...patch.flags?.graft, moulinette: entry.source } };
      next = { ...entry, patch };
      delete next.source;
    }

    const rewritten = await rewriteRefs(next.patch ?? {}, resolve);
    next = { ...next, patch: rewritten.value };
    // Reported, never silent: a scene short one of forty textures still builds,
    // and somebody should know which one is missing rather than wondering why a
    // tile is blank.
    for (const reason of problems) skipped.push({ id: entry.id, reason });
    out.push(next);
  }

  return { entries: out, skipped };
}

/** Cheap enough to run over every entry before touching the network. */
function mentionsRef(value) {
  if (isMoulinetteRef(value)) return true;
  if (Array.isArray(value)) return value.some(mentionsRef);
  if (value && typeof value === "object") return Object.values(value).some(mentionsRef);
  return false;
}
