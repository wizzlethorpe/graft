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
      // A subtree replaced rather than merged, which is where an empty or
      // absent array lands: `isKeyedArray` needs a member to recognise one, so
      // the first entry added to an empty collection never reaches `diffById`.
      patch[key] = markWhole(structuredClone(value), whole);
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
function diffById(source, result, whole) {
  const before = new Map(source.map((e) => [e._id, e]));
  const entries = [];
  for (const entry of result) {
    const prior = before.get(entry._id);
    if (!prior) {
      // Nothing to diff against, so the entry travels whole. Recorded because
      // the caller cannot tell afterwards: a merge patch is shaped like the
      // document it patches, which is what makes it readable and what makes
      // the two indistinguishable once the base has gone out of scope.
      whole?.add(entry._id);
      entries.push(structuredClone(entry));
      continue;
    }
    const sub = diff(prior, entry, whole);
    if (sub !== undefined) entries.push({ _id: entry._id, ...sub });
  }
  return entries.length > 0 ? entries : undefined;
}

/**
 * Record every `_id` inside a subtree the diff is emitting wholesale.
 *
 * Nothing in it had a prior, so every document in it is whole. Returns its
 * argument so it can wrap a `structuredClone` in place.
 */
function markWhole(value, whole) {
  if (!whole) return value;
  if (Array.isArray(value)) {
    for (const v of value) markWhole(v, whole);
    return value;
  }
  if (!isPlainObject(value)) return value;
  if (typeof value._id === "string") whole.add(value._id);
  for (const v of Object.values(value)) markWhole(v, whole);
  return value;
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
const VOLATILE = new Set(["_stats"]);

// `folder` is stripped at the root only, and the depth is the whole point.
// On the document itself an id names a folder in one world or pack and
// resolves to nothing elsewhere, so it travels as a path of names instead.
// Inside an Adventure it means something entirely different: an Adventure
// carries its own `folders` array, and its embedded documents point into that,
// which travels with them. Stripping at depth would ship the folders empty and
// dump every document at the root.
const ROOT_ONLY = new Set(["folder"]);

// `ownership` is half world-local and half not, so it is thinned rather than
// dropped. The per-user entries are ids from one world and mean nothing
// anywhere else; `default` is a real authorial decision, and the only way to
// say "players can see this" about a handout, a player-facing item, or a scene
// they can navigate to.
const OWNERSHIP_KEEP = new Set(["default"]);

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
export function stripVolatile(value, root = true) {
  if (Array.isArray(value)) return value.map((v) => stripVolatile(v, false));
  if (!isPlainObject(value)) return value;
  const out = {};
  for (const [k, v] of Object.entries(value)) {
    if (VOLATILE.has(k)) continue;
    if (root && ROOT_ONLY.has(k)) continue;
    if (k === "ownership" && isPlainObject(v)) {
      const kept = Object.fromEntries(
        Object.entries(v).filter(([who]) => OWNERSHIP_KEEP.has(who)));
      // Omitted when nothing survives, so a document whose only ownership was
      // per-user does not read as having lost something.
      if (Object.keys(kept).length > 0) out[k] = kept;
      continue;
    }
    out[k] = stripVolatile(v, false);
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
export async function referenceSources(patch, { sourceOf, resolve, isWhole }) {
  if (Array.isArray(patch)) {
    return Promise.all(patch.map(async (entry) => {
      if (!isPlainObject(entry) || typeof entry._id !== "string") return entry;
      const source = sourceOf(entry._id);
      // Only a *whole* entry can be referenced, and whether it is one is the
      // caller's to say: `diff` recorded it, or there was no diff and every
      // entry is whole by construction. Guessing from shape got it wrong both
      // ways, missing documents with no `type` field (journals, scenes, tables)
      // and mistaking a rename-and-retype for a whole document, which then
      // diffed against the full source and nulled out everything it did not
      // mention.
      if (!source || !isWhole(entry._id)) return referenceSources(entry, { sourceOf, resolve, isWhole });
      const base = await resolve(source);
      if (!base) return entry;
      // Both sides without their ids: the source's is theirs and ours is ours,
      // and spreading `_id: undefined` would leave the key present and read as a
      // change rather than removing it.
      const { _id: _mine, ...body } = entry;
      const { _id: _theirs, ...theirBody } = stripVolatile(base);
      // `base` is a document at its own root, so its folder is world-local and
      // goes. `body` is already an embedded entry, so its folder is an
      // adventure-internal pointer and stays.
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
