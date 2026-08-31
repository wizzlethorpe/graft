// Deciding what to hydrate, and in what order.
//
// An entry's `id` is a Foundry document id rather than a slug so that its
// output is addressable as an ordinary UUID:
//
//   Compendium.<module>.<pack>.<Type>.<id>
//
// That makes a graft onto a graft unremarkable. B names A's output the same way
// it would name a a bestiary entry, and A's module is an ordinary
// dependency. Only the order is new: A must exist before B is applied, and
// within one module that is ours to work out.

import { embeddedSources, rewriteSources } from "./patch.mjs";

const DOCUMENT_ID = /^[a-zA-Z0-9]{16}$/;

/**
 * The sources an entry names, in the order to try them.
 *
 * A list is a fallback: "the bestiary copy if that module is installed,
 * otherwise the reference one". The first that resolves wins, so an author can
 * target better content without requiring it.
 */
export function sourcesOf(entry) {
  const source = entry?.source;
  if (typeof source === "string") return source ? [source] : [];
  if (Array.isArray(source)) return source.filter((s) => typeof s === "string" && s);
  return [];
}

/** Foundry's own rule, from `isValidId`. */
export function isDocumentId(id) {
  return typeof id === "string" && DOCUMENT_ID.test(id);
}

/** Where an entry lands once hydrated, and how anything else addresses it. */
export function entryUuid(entry, moduleId) {
  return `Compendium.${moduleId}.${entry.pack}.${entry.type}.${entry.id}`;
}

/**
 * Resolve `source` values that name a sibling by bare id.
 *
 * Unambiguous by construction: no document type name is sixteen characters,
 * and a bare id is not a UUID, so nothing else a source may hold looks like
 * one. What a bare id cannot express is which pack it meant, so an id two
 * entries share names neither and is reported rather than guessed at.
 */
export function resolveSiblingIds(entries, moduleId) {
  const byId = new Map();
  const ambiguous = new Set();
  for (const entry of entries) {
    if (!isDocumentId(entry?.id)) continue;
    if (byId.has(entry.id)) ambiguous.add(entry.id);
    else byId.set(entry.id, entry);
  }

  const resolved = [];
  const invalid = [];
  for (const entry of entries) {
    const problems = [];
    const map = (source) => {
      if (typeof source !== "string" || !DOCUMENT_ID.test(source)) return source;
      if (ambiguous.has(source)) {
        problems.push(`source "${source}" names more than one entry; say which pack with a full UUID`);
        return source;
      }
      const target = byId.get(source);
      if (!target) {
        problems.push(`source "${source}" names no entry in this module`);
        return source;
      }
      return entryUuid(target, moduleId);
    };

    const next = { ...entry };
    if (entry.source !== undefined) {
      next.source = Array.isArray(entry.source) ? entry.source.map(map) : map(entry.source);
    }
    if (entry.patch !== undefined) next.patch = rewriteSources(entry.patch, map);

    if (problems.length > 0) invalid.push({ entry, reason: problems.join("; ") });
    else resolved.push(next);
  }
  return { entries: resolved, invalid };
}

/**
 * Order entries so anything grafted onto a sibling comes after it.
 *
 * Only edges *within* the module need sequencing. A source pointing outside it
 * either resolves at hydration or does not, and Foundry reports a missing
 * dependency better than we could.
 *
 * @returns `{ order, invalid, cycles }`. `invalid` cannot be addressed at all;
 *   `cycles` graft onto each other and are not buildable.
 */
export function planOrder(entries, moduleId) {
  const invalid = [];
  const named = [];
  for (const entry of entries) {
    const why = describeInvalid(entry);
    if (why) invalid.push({ entry, reason: why });
    else named.push(entry);
  }
  // Before the uuid map, so a source naming a sibling by id is an edge like
  // any other from here on and nothing downstream knows the short form.
  const sibling = resolveSiblingIds(named, moduleId);
  invalid.push(...sibling.invalid);
  const usable = sibling.entries;

  // uuid -> entry, so a source naming a sibling is recognisable as an edge.
  // Two entries with one uuid would silently collapse to whichever came last.
  const byUuid = new Map();
  for (const entry of usable) {
    const uuid = entryUuid(entry, moduleId);
    if (byUuid.has(uuid)) invalid.push({ entry, reason: `duplicates another entry's id in pack "${entry.pack}"` });
    else byUuid.set(uuid, entry);
  }

  const order = [];
  const done = new Set();
  const cycles = [];

  const visit = (entry, chain) => {
    const uuid = entryUuid(entry, moduleId);
    if (done.has(uuid)) return;
    if (chain.has(uuid)) {
      const seq = [...chain];
      cycles.push([...seq.slice(seq.indexOf(uuid)), uuid]);   // the loop, not the path into it
      return;
    }
    chain.add(uuid);
    // Any candidate naming a sibling is an edge: the parent has to be built
    // before this entry, whichever of them ends up resolving. An item a patch
    // inserts counts too — it is resolved out of the pack at build time, so it
    // has to be in there already.
    for (const candidate of [...sourcesOf(entry), ...embeddedSources(entry.patch ?? {})]) {
      const parent = byUuid.get(candidate);
      if (parent) visit(parent, chain);
    }
    chain.delete(uuid);
    done.add(uuid);
    order.push(entry);
  };

  for (const entry of usable) visit(entry, new Set());

  // Half-building one is worse than skipping it: the pack would hold a
  // document nobody can explain.
  const looped = new Set(cycles.flat());
  return {
    order: order.filter((e) => !looped.has(entryUuid(e, moduleId))),
    invalid,
    cycles,
  };
}

function describeInvalid(entry) {
  if (!isDocumentId(entry?.id)) {
    return `id must be 16 characters of [a-zA-Z0-9] so the result has a real UUID, got ${JSON.stringify(entry?.id)}`;
  }
  // Optional: an entry with no source is the author's own content, carried
  // whole, and belongs in the same pack as the things it borrows.
  if ("source" in entry && sourcesOf(entry).length === 0) {
    return "source, when given, must name the document this grafts onto, or list documents to try in order";
  }
  if (typeof entry.type !== "string" || !entry.type) {
    return "type must name a document type, since it decides the UUID and the pack";
  }
  if (typeof entry.pack !== "string" || !entry.pack) {
    return "pack must name the compendium this lands in";
  }
  return null;
}
