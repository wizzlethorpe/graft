// External providers: a stage between reading a module's entries and building
// them, where something else gets to rewrite them first.
//
// A provider is one function. It receives every entry the module declares, from
// every file it declares them in, and returns whatever it wants built instead.
// Moulinette is the motivating case: fetch the document it names, apply the
// patch to that JSON, and hand back a sourceless entry carrying the result. No
// pack of its own, no ids to collide, and the shape it produces is one graft
// already understands.
//
// Providers run from a queue rather than to a fixed point. "Is there work left"
// is answerable; "has anything changed" is not. A provider that emits syntax
// another provider handles enqueues that provider, because the one producing
// the syntax is the only one that knows it did.

const DEFAULT_MAX_RUNS = 25;

const registry = new Map();

/**
 * Register a provider.
 *
 * @param {object} provider
 * @param {string} provider.id      unique, and how others enqueue it
 * @param {string} [provider.label] for the build report; defaults to the id
 * @param {function} provider.hydrate  `(entries) => entries | { entries, skipped, enqueue }`
 */
export function registerProvider(provider) {
  if (typeof provider?.id !== "string" || !provider.id) {
    throw new Error("a graft provider needs an id");
  }
  if (typeof provider.hydrate !== "function") {
    throw new Error(`graft provider "${provider.id}" needs a hydrate function`);
  }
  registry.set(provider.id, { label: provider.id, ...provider });
  return provider.id;
}

export function registeredProviders() {
  return [...registry.values()];
}

/**
 * Run every provider over the entries, in order, until the queue empties.
 *
 * @returns `{ entries, skipped }`. `skipped` carries the provider id so the
 *   build report can section by it, and uses the same shape hydration does, so
 *   a reader sees one list rather than two.
 */
export async function runProviders(entries, providers = registeredProviders(), { maxRuns = DEFAULT_MAX_RUNS, onProvider } = {}) {
  const byId = new Map(providers.map((p) => [p.id, p]));
  const queue = providers.map((p) => p.id);
  // Membership of the queue, not history. A provider may run several times
  // across a build; it just never waits in the queue twice. Deduplicating
  // against history instead would stop a provider re-running for input that did
  // not exist when it first ran, which is the whole reason for the queue.
  const pending = new Set(queue);
  const runs = new Map();
  const halted = new Set();

  let current = entries;
  const skipped = [];

  while (queue.length > 0) {
    const id = queue.shift();
    pending.delete(id);
    const provider = byId.get(id);
    if (!provider) continue;

    const count = (runs.get(id) ?? 0) + 1;
    runs.set(id, count);
    if (count > maxRuns) {
      // Named, because a bare "too many iterations" says nothing about which of
      // five providers is looping.
      if (!halted.has(id)) {
        halted.add(id);
        skipped.push({ provider: id, id: "(provider)",
          reason: `ran ${maxRuns} times without settling; something keeps enqueueing it` });
      }
      continue;
    }

    let result;
    try {
      onProvider?.(provider);
      result = await provider.hydrate(current);
    } catch (err) {
      // One provider failing is not a reason to abandon the rest, or the
      // entries that need no provider at all.
      skipped.push({ provider: id, id: "(provider)", reason: err.message });
      continue;
    }

    const { entries: next, skipped: theirs, enqueue } = normalize(result);
    if (next) current = next;
    for (const item of theirs) skipped.push({ provider: id, ...item });

    for (const wanted of enqueue) {
      if (wanted === id) {
        // The honest version of this is "I have not finished", which is
        // something to do before returning, not after.
        skipped.push({ provider: id, id: "(provider)",
          reason: "tried to enqueue itself, which is ignored" });
        continue;
      }
      if (!byId.has(wanted)) {
        skipped.push({ provider: id, id: "(provider)",
          reason: `wanted to run "${wanted}" next, which is not registered` });
        continue;
      }
      if (pending.has(wanted) || halted.has(wanted)) continue;
      queue.push(wanted);
      pending.add(wanted);
    }
  }

  return { entries: current, skipped };
}

/** An array, or `{ entries, skipped, enqueue }`, or nothing. */
function normalize(result) {
  if (Array.isArray(result)) return { entries: result, skipped: [], enqueue: [] };
  if (!result || typeof result !== "object") return { entries: null, skipped: [], enqueue: [] };
  return {
    entries: Array.isArray(result.entries) ? result.entries : null,
    skipped: Array.isArray(result.skipped) ? result.skipped : [],
    enqueue: Array.isArray(result.enqueue) ? result.enqueue : [],
  };
}
