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

const isPlainObject = (v) => v !== null && typeof v === "object" && !Array.isArray(v);

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
