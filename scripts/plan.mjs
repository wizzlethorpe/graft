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

const DOCUMENT_ID = /^[a-zA-Z0-9]{16}$/;

/** Foundry's own rule, from `isValidId`. */
export function isDocumentId(id) {
  return typeof id === "string" && DOCUMENT_ID.test(id);
}

/** Where an entry lands once hydrated, and how anything else addresses it. */
export function entryUuid(entry, moduleId) {
  return `Compendium.${moduleId}.${entry.pack}.${entry.type}.${entry.id}`;
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
  const usable = [];
  for (const entry of entries) {
    const why = describeInvalid(entry);
    if (why) invalid.push({ entry, reason: why });
    else usable.push(entry);
  }

  // uuid -> entry, so a source naming a sibling is recognisable as an edge.
  const byUuid = new Map(usable.map((e) => [entryUuid(e, moduleId), e]));

  const order = [];
  const done = new Set();
  const cycles = [];

  const visit = (entry, chain) => {
    const uuid = entryUuid(entry, moduleId);
    if (done.has(uuid)) return;
    if (chain.has(uuid)) {
      // The loop itself, since the useful thing to print is which entries form it.
      cycles.push([...chain, uuid]);
      return;
    }
    chain.add(uuid);
    const parent = byUuid.get(entry.source);
    if (parent) visit(parent, chain);
    chain.delete(uuid);
    if (!done.has(uuid)) {
      done.add(uuid);
      order.push(entry);
    }
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
  if ("source" in entry && (typeof entry.source !== "string" || !entry.source)) {
    return "source, when given, must name the document this grafts onto";
  }
  if (typeof entry.type !== "string" || !entry.type) {
    return "type must name a document type, since it decides the UUID and the pack";
  }
  if (typeof entry.pack !== "string" || !entry.pack) {
    return "pack must name the compendium this lands in";
  }
  return null;
}
