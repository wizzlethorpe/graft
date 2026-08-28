// The diff format. Pure: no Foundry, no I/O, so it can be reasoned about and
// tested on its own, which is the whole point of prototyping this separately.
//
// RFC 7386 (JSON Merge Patch), with exactly one addition. Merge patch is the
// right default because a patch mirrors the shape of the thing it patches, so
// it reads as YAML a person can write, and `null` already means "delete this
// key" without inventing a sentinel.
//
// The addition is for arrays. Merge patch replaces an array wholesale, and
// JSON Patch (RFC 6902) addresses array members by index. Neither suits
// Foundry, where an array is a collection of embedded documents that each
// carry an `_id` and whose order is not meaningful. Changing one item's price
// should not mean restating forty items, and should not break when the source
// reorders them. So:
//
//   **Arrays whose members all carry `_id` merge by that key. Everything else
//   replaces.**
//
// That one rule is the only place this departs from a published standard, and
// it exists because Foundry's data model gave those arrays keys.

/**
 * A plain data object, and not merely "an object".
 *
 * The distinction is load-bearing. A patch is always plain JSON, but the
 * *source* it is diffed against arrives from Foundry, and a live Document is a
 * class instance whose embedded collections hold a `model` back-reference to
 * the document that owns them: Actor to items to model to Actor. Walking one
 * recursively never returns, which is how the first real export died with
 * "Maximum call stack size exceeded".
 *
 * Callers are expected to pass `toObject()` output. Checking the prototype
 * means a caller who forgets gets a wrong answer immediately rather than a
 * stack overflow several seconds later.
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

/**
 * Apply a merge patch to a document, returning a new object.
 *
 * `target` is never mutated: hydration applies a patch to somebody else's
 * document, and mutating the source in place would corrupt the pack it was
 * read from.
 */
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
 * Entries present in both are patched. Entries only in the patch are appended,
 * which is how you add an item to a statblock. Entries only in the target
 * survive, which is what makes a patch a diff rather than a replacement: you
 * are saying what differs, not restating the whole collection.
 *
 * Removing an entry is the one thing this cannot express, and deliberately so
 * (see `diff`).
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
 * The merge patch that turns `source` into `result`.
 *
 * This is the authoring half, and the reason the whole idea is usable: you
 * import somebody's monster, edit it in the ordinary sheet, and this recovers
 * what you changed. Nobody writes one of these by hand.
 *
 * Returns `undefined` when nothing differs, so an unchanged branch is omitted
 * rather than emitted as `{}`.
 */
export function diff(source, result) {
  if (!isPlainObject(source) || !isPlainObject(result)) {
    return equal(source, result) ? undefined : structuredClone(result);
  }

  const patch = {};
  for (const [key, value] of Object.entries(result)) {
    if (!(key in source)) {
      patch[key] = structuredClone(value);
      continue;
    }
    const before = source[key];
    if (isKeyedArray(before) && isKeyedArray(value)) {
      const arr = diffById(before, value);
      if (arr) patch[key] = arr;
    } else if (isPlainObject(before) && isPlainObject(value)) {
      const sub = diff(before, value);
      if (sub !== undefined) patch[key] = sub;
    } else if (!equal(before, value)) {
      patch[key] = structuredClone(value);
    }
  }
  // A key the source had and the result does not is a deletion, which merge
  // patch spells as null.
  for (const key of Object.keys(source)) {
    if (!(key in result)) patch[key] = null;
  }
  return Object.keys(patch).length > 0 ? patch : undefined;
}

/**
 * Changed and added entries only, each carrying its `_id` so it can be found
 * again.
 *
 * An entry the result dropped is *not* representable: merge-by-id has no way
 * to say "remove this one", because a patch that omits an entry means "leave
 * it alone". That is a real limit and the honest place to stop. A format that
 * needed deletions would reach for RFC 6902 `remove` ops, and pay for it by
 * addressing members positionally, which is the thing keying by `_id` avoids.
 */
function diffById(source, result) {
  const before = new Map(source.map((e) => [e._id, e]));
  const entries = [];
  for (const entry of result) {
    const prior = before.get(entry._id);
    if (!prior) {
      entries.push(structuredClone(entry));
      continue;
    }
    const sub = diff(prior, entry);
    if (sub !== undefined) entries.push({ _id: entry._id, ...sub });
  }
  return entries.length > 0 ? entries : undefined;
}

function equal(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

/**
 * Fields that describe *this copy* of a document rather than the document, and
 * so are noise in a diff.
 *
 * `_stats` is timestamps and the id of whoever last touched it: two documents
 * with identical content differ here, so leaving it in reports every embedded
 * item as changed when none are. `ownership` is a map of user ids from one
 * world. `folder` is a folder id from one world. None of the three mean
 * anything on the machine that will apply the patch, and the user id is not
 * ours to ship.
 */
const VOLATILE = new Set(["_stats", "ownership", "folder"]);

// Nothing else is removed, and in particular no other module's flags. Each of
// the three above earns it: `_stats` makes an unchanged document read as
// changed, `folder` would file the result in a folder that does not exist on
// the reader's machine, and `ownership` would write permissions for user ids
// from another world. A third party's flag does neither. It may be noise in
// the patch, but tidying it is an editorial judgement about somebody else's
// data, and acting on it would commit this to maintaining a list of other
// people's module names.


/**
 * A copy with the volatile fields removed, at every depth.
 *
 * Every depth because embedded documents carry their own `_stats`: stripping
 * only the top level leaves each item in an actor's inventory looking edited.
 */
export function stripVolatile(value) {
  if (Array.isArray(value)) return value.map(stripVolatile);
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (!VOLATILE.has(k)) out[k] = stripVolatile(v);
  }
  return out;
}

// ── nested grafts ───────────────────────────────────────────────────────────
//
// An embedded document can be somebody else's content too. Adding a magic item
// to a statblock puts that item's whole body in the patch, description and
// all, which is the one thing this format exists to avoid: the artifact would
// be redistributing content rather than pointing at it.
//
// So an entry in a keyed array takes one of two shapes:
//
//   { _id }              patch an entry that is already there
//   { _id, source, ... } resolve `source`, patch it, insert it
//
// The second is a graft inside a graft, and it addresses its source the same
// way the outer one does. Resolution is injected rather than imported so the
// walk stays testable without Foundry.

/** An entry that names content to fetch rather than carrying it. */
export function isSourcedEntry(v) {
  return isPlainObject(v) && typeof v._id === "string" && typeof v.source === "string";
}

/**
 * Replace every sourced entry in a patch with the document it names, patched.
 *
 * Applied before `applyPatch`, so the merge itself stays pure and synchronous.
 * An entry whose source does not resolve throws with the UUID in the message:
 * a statblock silently missing the magic item it was built around is worse
 * than one that refuses to build and says which dependency is absent.
 */
export async function expandSources(patch, resolve) {
  if (Array.isArray(patch)) {
    return Promise.all(patch.map(async (entry) => {
      if (!isSourcedEntry(entry)) return expandSources(entry, resolve);
      const base = await resolve(entry.source);
      if (!base) throw new Error(`embedded source ${entry.source} did not resolve`);
      const inner = await expandSources(entry.patch ?? {}, resolve);
      // The id is ours, not the source's: this is our copy of their thing.
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
 * reference plus the little that differs from it.
 *
 * `sourceOf` answers what a given embedded id was imported from, which the
 * caller knows because Foundry recorded it before the volatile fields were
 * stripped. An entry with no recorded source stays as it is: content the
 * author wrote themselves is theirs to ship.
 */
export async function referenceSources(patch, { sourceOf, resolve }) {
  if (Array.isArray(patch)) {
    return Promise.all(patch.map(async (entry) => {
      if (!isPlainObject(entry) || typeof entry._id !== "string") return entry;
      const source = sourceOf(entry._id);
      // Only a *whole* entry is worth referencing. A partial patch of an entry
      // already in the source document has nothing embedded to strip out.
      if (!source || !isWholeDocument(entry)) return referenceSources(entry, { sourceOf, resolve });
      const base = await resolve(source);
      if (!base) return entry;
      // Both sides without their ids: the source's is theirs and ours is ours,
      // and spreading `_id: undefined` would leave the key present and read as a
      // change rather than removing it.
      const { _id: _mine, ...body } = entry;
      const { _id: _theirs, ...theirBody } = stripVolatile(base);
      const inner = diff(theirBody, stripVolatile(body));
      return { _id: entry._id, source, ...(inner ? { patch: inner } : {}) };
    }));
  }
  if (!isPlainObject(patch)) return patch;
  const out = {};
  for (const [k, v] of Object.entries(patch)) out[k] = await referenceSources(v, { sourceOf, resolve });
  return out;
}

/**
 * Whether an entry looks like a document in full rather than a patch of one.
 *
 * A patch names a handful of keys; a whole document carries the fields every
 * document has. `name` and `type` together are a good enough signal, and
 * guessing wrong is cheap in both directions: a missed reference ships a copy,
 * and a false one produces a patch against a document that already matches.
 */
function isWholeDocument(entry) {
  return typeof entry.name === "string" && typeof entry.type === "string";
}

/**
 * A document's folder as a path of names, or undefined when it is not in one.
 *
 * Names, not ids. `folder` is stripped from a patch because an id names a
 * folder in one particular world or pack and resolves to nothing anywhere
 * else, but the *shape* an author organised their work into is worth keeping,
 * and a path can be rebuilt on the other side.
 */
export function folderPath(document) {
  const names = [];
  for (let f = document?.folder; f; f = f.folder) names.unshift(f.name);
  return names.length > 0 ? names.join("/") : undefined;
}

/** "/Magic Items//Bags/" -> ["Magic Items", "Bags"]. Tolerates what people type. */
export function folderSegments(path) {
  return typeof path === "string" ? path.split("/").map((s) => s.trim()).filter(Boolean) : [];
}
