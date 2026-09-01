// Where another module joins in: rewriting entries before a build, and naming
// a source its own way on the way back out.
//
// Foundry hooks are synchronous, so both hooks only collect. `graftPreBuild`
// takes `{ id, label, transform, phase }` and the build awaits each transform
// once, entries before sources. `graftExport` takes `{ id, rewrite }`.

const PHASES = ["entries", "sources"];

/** The transforms registered for one module's build, in the order they run. Collecting runs nothing. */
export function collectTransforms(moduleId) {
  const transforms = [];
  const register = (t) => {
    if (typeof t?.id !== "string" || !t.id) throw new Error("a graft transform needs an id");
    if (typeof t.transform !== "function") throw new Error(`graft transform "${t.id}" needs a transform function`);
    const phase = t.phase ?? PHASES[0];
    if (!PHASES.includes(phase)) throw new Error(`graft transform "${t.id}" has no phase "${t.phase}"`);
    transforms.push({ label: t.id, ...t, phase });
  };
  Hooks.callAll("graftPreBuild", moduleId, register);
  return transforms.sort((a, b) => PHASES.indexOf(a.phase) - PHASES.indexOf(b.phase));
}

/**
 * Run each transform over the entries, once, in the order they were collected.
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

/** The export rewriters, collected the same way and running nothing. */
export function collectRewriters() {
  const rewriters = [];
  Hooks.callAll("graftExport", (r) => {
    if (typeof r?.id !== "string" || !r.id) throw new Error("a graft export rewriter needs an id");
    if (typeof r.rewrite !== "function") throw new Error(`graft export rewriter "${r.id}" needs a rewrite function`);
    rewriters.push(r);
  });
  return rewriters;
}

/**
 * Let each rewriter name the entry's source its own way.
 *
 * One failing costs the nicer spelling, not the copy: what `exportDiff` already
 * produced is a working entry, so the reason is logged and it travels as it is.
 */
export async function rewriteEntry(entry, document, rewriters = collectRewriters()) {
  let current = entry;
  for (const r of rewriters) {
    try {
      current = (await r.rewrite(current, { document })) ?? current;
    } catch (err) {
      console.warn(`Graft | ${r.id} could not name the source of ${document.name}:`, err);
    }
  }
  return current;
}
