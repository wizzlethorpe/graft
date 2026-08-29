// The diff format: RFC 7386 (JSON Merge Patch) with one addition.
//
// Merge patch suits this because a patch mirrors the shape of what it patches,
// so it reads as JSON a person can write, and `null` already means "delete this
// key". Its one weakness is arrays, which it replaces wholesale. Foundry's
// arrays are collections of embedded documents that each carry an `_id` and
// whose order is not meaningful, so:
//
//   Arrays whose members all carry `_id` merge by that key. Everything else
//   replaces.
//
// No Foundry and no I/O in this file, so the format can be tested on its own.

/**
 * A plain data object, as opposed to any object.
 *
 * Load-bearing: a live Foundry Document holds back-references from its embedded
 * collections to itself, so walking one recursively never returns. Callers pass
 * `toObject()` output, and checking the prototype turns a forgotten call into a
 * wrong answer rather than a stack overflow.
 */
function isPlainObject(v) {
  if (v === null || typeof v !== "object" || Array.isArray(v)) return false;
  const proto = Object.getPrototypeOf(v);
  return proto === Object.prototype || proto === null;
}

/** An array Foundry would treat as a keyed collection rather than a list. */
export function isKeyedArray(v) {
  return Array.isArray(v) && v.length > 0 && v.every((e) => isPlainObject(e) && typeof e._id === "string");
}

/** Apply a merge patch, returning a new object. `target` is never mutated. */
export function applyPatch(target, patch) {
  if (!isPlainObject(patch)) return structuredClone(patch);
  const out = isPlainObject(target) ? structuredClone(target) : {};
  for (const [key, value] of Object.entries(patch)) {
    if (value === null) {
      delete out[key];
    } else if (isKeyedArray(value) && isKeyedArray(out[key])) {
      out[key] = mergeById(out[key], value);
    } else if (isPlainObject(value)) {
      out[key] = applyPatch(out[key], value);
    } else {
      out[key] = structuredClone(value);
    }
  }
  return out;
}

/**
 * Merge one keyed array into another.
 *
 * Entries in both are patched, entries only in the patch are appended, and
 * entries only in the target survive. That last is what makes a patch a diff
 * rather than a replacement, and is also why removal is not representable: an
 * omitted entry means "leave it alone".
 */
function mergeById(target, patch) {
  const byId = new Map(target.map((e) => [e._id, e]));
  for (const entry of patch) {
    const existing = byId.get(entry._id);
    byId.set(entry._id, existing ? applyPatch(existing, entry) : structuredClone(entry));
  }
  return [...byId.values()];
}

/**
 * The merge patch that turns `source` into `result`, or `undefined` if nothing
 * differs.
 *
 * `whole` is an optional Set that collects the `_id` of every entry emitted as
 * a complete document rather than a delta. A merge patch is shaped like the
 * document it patches, so the two are indistinguishable afterwards, and
 * `referenceSources` needs to tell them apart.
 */
export function diff(source, result, whole) {
  if (!isPlainObject(source) || !isPlainObject(result)) {
    if (equal(source, result)) return undefined;
    return markWhole(structuredClone(result), whole);
  }

  const patch = {};
  for (const [key, value] of Object.entries(result)) {
    if (!(key in source)) {
      patch[key] = markWhole(structuredClone(value), whole);
      continue;
    }
    const before = source[key];
    if (isKeyedArray(before) && isKeyedArray(value)) {
      const arr = diffById(before, value, whole);
      if (arr) patch[key] = arr;
    } else if (isPlainObject(before) && isPlainObject(value)) {
      const sub = diff(before, value, whole);
      if (sub !== undefined) patch[key] = sub;
    } else if (!equal(before, value)) {
      // Replaced rather than merged, which is where an empty or absent array
      // lands: `isKeyedArray` needs a member, so the first entry added to an
      // empty collection never reaches `diffById`.
      patch[key] = markWhole(structuredClone(value), whole);
    }
  }
  for (const key of Object.keys(source)) {
    if (!(key in result)) patch[key] = null;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/** Changed and added entries only, each carrying its `_id`. */
function diffById(source, result, whole) {
  const before = new Map(source.map((e) => [e._id, e]));
  const entries = [];
  for (const entry of result) {
    const prior = before.get(entry._id);
    if (!prior) {
      whole?.add(entry._id);
      entries.push(structuredClone(entry));
      continue;
    }
    const sub = diff(prior, entry, whole);
    if (sub !== undefined) entries.push({ _id: entry._id, ...sub });
  }
  return entries.length > 0 ? entries : undefined;
}

/** Record every `_id` in a subtree being emitted wholesale. Returns its argument. */
function markWhole(value, whole) {
  if (!whole) return value;
  if (Array.isArray(value)) {
    for (const v of value) markWhole(v, whole);
  } else if (isPlainObject(value)) {
    if (typeof value._id === "string") whole.add(value._id);
    for (const v of Object.values(value)) markWhole(v, whole);
  }
  return value;
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

// Fields describing *this copy* rather than the document. Each earns removal by
// making a patch wrong or making applying one do the wrong thing; a third
// party's flags do neither, so they travel untouched.
//
//   _stats         timestamps and a user id, so an unchanged document reads as changed
//   flags.graft    our own record of where this copy came from
//   folder         a folder id from one world, and only at the root: inside an
//                  Adventure it points into that adventure's own `folders`
//                  array, which travels with it
//   ownership      thinned rather than dropped. Per-user entries are ids from
//                  one world; `default` is how you say "players can see this"
const VOLATILE = new Set(["_stats"]);
const ROOT_ONLY = new Set(["folder"]);
const OWNERSHIP_KEEP = new Set(["default"]);

/** A copy with the volatile fields removed, at every depth. */
export function stripVolatile(value, root = true) {
  if (Array.isArray(value)) return value.map((v) => stripVolatile(v, false));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (VOLATILE.has(k)) continue;
    if (root && ROOT_ONLY.has(k)) continue;
    if (k === "flags" && isPlainObject(v)) {
      const { graft: _ours, ...rest } = v;
      out[k] = stripVolatile(rest, false);
    } else if (k === "ownership" && isPlainObject(v)) {
      const kept = Object.fromEntries(
        Object.entries(v).filter(([who]) => OWNERSHIP_KEEP.has(who)));
      // Omitted when empty, so a purely per-user map does not read as a change.
      if (Object.keys(kept).length > 0) out[k] = kept;
    } else {
      out[k] = stripVolatile(v, false);
    }
  }
  return out;
}

// ── nested grafts ───────────────────────────────────────────────────────────
//
// An embedded document can be somebody else's content too: adding a magic item
// to a statblock would otherwise put that item's whole body in the patch. So an
// entry in a keyed array takes one of two shapes:
//
//   { _id }               patch an entry already there
//   { _id, source, patch } resolve `source`, patch it, insert it
//
// Resolution is injected rather than imported, so the walk stays testable
// without Foundry.

function isSourcedEntry(v) {
  return isPlainObject(v) && typeof v._id === "string" && typeof v.source === "string";
}

/**
 * Replace every sourced entry with the document it names, patched.
 *
 * Runs before `applyPatch` so the merge stays synchronous. An unresolvable
 * source throws: a statblock silently missing the item it was built around is
 * worse than one that refuses to build and names the dependency.
 */
export async function expandSources(patch, resolve) {
  if (Array.isArray(patch)) {
    return Promise.all(patch.map(async (entry) => {
      if (!isSourcedEntry(entry)) return expandSources(entry, resolve);
      const base = await resolve(entry.source);
      if (!base) throw new Error(`embedded source ${entry.source} did not resolve`);
      const inner = await expandSources(entry.patch ?? {}, resolve);
      // The id is ours: this is our copy of their thing.
      return { ...applyPatch(base, inner), _id: entry._id };
    }));
  }
  if (!isPlainObject(patch)) return patch;
  const out = {};
  for (const [k, v] of Object.entries(patch)) out[k] = await expandSources(v, resolve);
  return out;
}

/**
 * The reverse, for authoring: turn a whole embedded document back into a
 * reference plus what differs from it.
 *
 * `sourceOf` says what an embedded id was imported from. `isWhole` says whether
 * the entry is a complete document rather than a delta, which only the caller
 * can know: `diff` recorded it, or there was no diff and everything is whole.
 * Referencing a delta would diff it against the full source and null out every
 * field it did not mention.
 */
export async function referenceSources(patch, { sourceOf, resolve, isWhole }) {
  if (Array.isArray(patch)) {
    return Promise.all(patch.map(async (entry) => {
      if (!isPlainObject(entry) || typeof entry._id !== "string") return entry;
      const source = sourceOf(entry._id);
      if (!source || !isWhole(entry._id)) return referenceSources(entry, { sourceOf, resolve, isWhole });
      const base = await resolve(source);
      if (!base) return entry;
      // Ids dropped from both sides; spreading `_id: undefined` would leave the
      // key present and read as a change.
      const { _id: _mine, ...body } = entry;
      const { _id: _theirs, ...theirBody } = stripVolatile(base);
      // `base` is a document at its root, so its folder is world-local. `body`
      // is already embedded, so its folder points inside an adventure.
      const inner = diff(theirBody, stripVolatile(body, false));
      return { _id: entry._id, source, ...(inner ? { patch: inner } : {}) };
    }));
  }
  if (!isPlainObject(patch)) return patch;
  const out = {};
  for (const [k, v] of Object.entries(patch)) out[k] = await referenceSources(v, { sourceOf, resolve, isWhole });
  return out;
}

/**
 * A document's folder as a path of names, or undefined if it is not in one.
 *
 * Names rather than the id, which resolves to nothing on another machine, so
 * the organisation survives even though the pointer cannot.
 */
export function folderPath(document) {
  const names = [];
  for (let f = document?.folder; f; f = f.folder) names.unshift(f.name);
  return names.length > 0 ? names.join("/") : undefined;
}

/** `"/Magic Items//Bags/"` to `["Magic Items", "Bags"]`. */
export function folderSegments(path) {
  return typeof path === "string" ? path.split("/").map((s) => s.trim()).filter(Boolean) : [];
}
