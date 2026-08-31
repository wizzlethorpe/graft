// The one moment another module can rewrite entries before a build: expanding
// a marker its grafts.json ships, fetching what only it knows how to fetch.
//
// Foundry hooks are synchronous, so `graftPreBuild` only collects: a handler
// registers `{ id, label, transform }` and the build awaits each transform
// once, in registration order. A module whose output needs further work does
// that work itself, in `graftBuilt`.

/** The transforms registered for one module's build. Collecting runs nothing. */
export function collectTransforms(moduleId) {
  const transforms = [];
  const register = (t) => {
    if (typeof t?.id !== "string" || !t.id) throw new Error("a graft transform needs an id");
    if (typeof t.transform !== "function") throw new Error(`graft transform "${t.id}" needs a transform function`);
    transforms.push({ label: t.id, ...t });
  };
  Hooks.callAll("graftPreBuild", moduleId, register);
  return transforms;
}

/**
 * Run each transform over the entries, once, in registration order.
 *
 * One failing is not a reason to abandon the rest, or the entries that need no
 * transform at all. `skipped` and `warnings` use the builder's `{ id, reason }`
 * shape plus `by`, the label of whoever reported it, so the report can section
 * them.
 *
 * @returns `{ entries, skipped, warnings }`
 */
export async function runTransforms(transforms, entries, { onTransform } = {}) {
  let current = entries;
  const skipped = [];
  const warnings = [];

  for (const t of transforms) {
    let result;
    try {
      onTransform?.(t);
      result = await t.transform(current);
    } catch (err) {
      skipped.push({ by: t.label, id: "(transform)", reason: err.message });
      continue;
    }
    const { entries: next, skipped: theirs, warnings: theirWarnings } = normalize(result);
    if (next) current = next;
    for (const item of theirs) skipped.push({ by: t.label, ...item });
    for (const item of theirWarnings) warnings.push({ by: t.label, ...item });
  }

  return { entries: current, skipped, warnings };
}

/** An array, or `{ entries, skipped, warnings }`, or nothing. */
function normalize(result) {
  if (Array.isArray(result)) return { entries: result, skipped: [], warnings: [] };
  if (!result || typeof result !== "object") return { entries: null, skipped: [], warnings: [] };
  const list = (v) => (Array.isArray(v) ? v : []);
  return {
    entries: Array.isArray(result.entries) ? result.entries : null,
    skipped: list(result.skipped),
    warnings: list(result.warnings),
  };
}
