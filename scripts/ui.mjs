// Getting a module built without anybody opening a console.
//
// Two entry points, deliberately: one that finds the reader and one the reader
// can find. A module that only builds when prompted is broken the first time
// somebody dismisses the prompt, and a module that only builds from a button
// nobody knows about never gets built at all.

import { hydrate } from "./hydrate.mjs";

const MODULE_ID = "graft";
const SUPPRESSED = "suppressedPrompts";

/** Enabled modules that declare graft as a requirement, which is the convention. */
export function graftModules() {
  return game.modules.filter((m) => m.active
    && [...(m.relationships?.requires ?? [])].some((r) => r.id === MODULE_ID));
}

/** A module's entries, or [] when it ships none. */
export async function readGrafts(moduleId) {
  try {
    const res = await fetch(`modules/${moduleId}/grafts.json`);
    if (!res.ok) return [];
    const parsed = await res.json();
    return Array.isArray(parsed) ? parsed : parsed.entries ?? [];
  } catch {
    return [];
  }
}

/**
 * The entries a module declares that are not in its packs.
 *
 * Compared against the pack index rather than a stored "have I built this"
 * flag, so the answer stays true when somebody deletes a document by hand or
 * the module ships new entries in an update.
 */
export async function unbuilt(moduleId) {
  const entries = await readGrafts(moduleId);
  const missing = [];
  for (const entry of entries) {
    const pack = game.packs.get(`${moduleId}.${entry.pack}`);
    if (!pack) continue;                       // a pack Foundry has not read yet
    const index = await pack.getIndex();
    if (!index.get(entry.id)) missing.push(entry);
  }
  return missing;
}

/**
 * Offer to build anything a newly-enabled module has not built yet.
 *
 * Asked once per module and remembered, because a prompt that returns on every
 * world load is one people learn to dismiss without reading. Declining is not
 * permanent: the header control on the module's own packs is always there.
 */
export async function promptForUnbuilt() {
  if (!game.user.isGM) return;
  const suppressed = new Set(game.settings.get(MODULE_ID, SUPPRESSED));

  for (const module of graftModules()) {
    if (suppressed.has(module.id)) continue;
    const missing = await unbuilt(module.id);
    if (missing.length === 0) continue;

    const build = await foundry.applications.api.DialogV2.confirm({
      window: { title: `Graft: ${module.title}` },
      content: `<p><strong>${module.title}</strong> has `
        + `<strong>${missing.length}</strong> entr${missing.length === 1 ? "y" : "ies"} `
        + `that have not been built yet.</p>`
        + `<p>Building fetches them from the compendiums you already have. Nothing is downloaded, `
        + `and anything whose source is missing is skipped and named.</p>`,
      yes: { label: "Build" },
      no: { label: "Not now" },
      modal: false,
    }).catch(() => false);

    if (build) await buildAndReport(module.id);
    else {
      suppressed.add(module.id);
      await game.settings.set(MODULE_ID, SUPPRESSED, [...suppressed]);
    }
  }
}

/**
 * A Build control in the header of a graft module's own compendium windows.
 *
 * On the pack rather than replacing it: the reader still browses the contents
 * the ordinary way, and the one thing this adds sits where they are already
 * looking when they wonder why a pack is empty.
 */
export function addPackControl(app, controls) {
  const moduleId = app?.collection?.metadata?.packageName;
  if (!game.user.isGM || !moduleId) return;
  if (!graftModules().some((m) => m.id === moduleId)) return;
  controls.push({
    icon: "fa-solid fa-code-branch",
    label: "Build grafts",
    action: "graftBuild",
    onClick: () => buildAndReport(moduleId),
  });
}

/** Build one module and say what happened, in the console and on screen. */
export async function buildAndReport(moduleId) {
  const entries = await readGrafts(moduleId);
  if (entries.length === 0) {
    ui.notifications.warn(`${moduleId} ships no grafts.json.`);
    return null;
  }

  ui.notifications.info(`Building ${entries.length} graft(s) for ${moduleId}…`);
  const { built, skipped } = await hydrate(moduleId, entries, {
    onProgress: (i, total, entry) => console.log(`Graft | ${i}/${total} ${entry.id}`),
  });

  // Building is the answer to the prompt, so stop suppressing it: if entries
  // go missing later the reader should be asked again.
  const suppressed = new Set(game.settings.get(MODULE_ID, SUPPRESSED));
  if (suppressed.delete(moduleId)) {
    await game.settings.set(MODULE_ID, SUPPRESSED, [...suppressed]);
  }

  if (skipped.length > 0) {
    ui.notifications.warn(`${built.length} built, ${skipped.length} skipped. See the console.`);
    console.group(`Graft | ${skipped.length} skipped`);
    for (const { id, reason } of skipped) console.warn(`${id}: ${reason}`);
    console.groupEnd();
  } else {
    ui.notifications.info(
      `Built ${built.length} graft(s). Find them in the Compendium tab, under ${moduleId}'s packs.`,
    );
  }
  return { built, skipped };
}

/** The setting the prompt remembers itself in. */
export function registerSettings() {
  game.settings.register(MODULE_ID, SUPPRESSED, {
    name: "Modules whose build prompt has been declined",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });
}
