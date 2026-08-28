// Module entry point: where the grafts are read from, and the two things a
// person does with them.

import { hydrate, exportDiff } from "./hydrate.mjs";
import { toYaml } from "./yaml.mjs";

const MODULE_ID = "graft";

Hooks.once("init", () => {
  game.modules.get(MODULE_ID).api = { hydrate, exportDiff, readGrafts, buildPacks };
});

/**
 * A "Copy graft" control on every document sheet.
 *
 * On the sheet rather than in a sidebar context menu because the document you
 * want to export is the one you have just finished editing, and it is already
 * open in front of you.
 *
 * The hook name is `getHeaderControls` + a class name, not `getHeaderControls`.
 * ApplicationV2 appends each class in the inheritance chain and fires one hook
 * per name, so a listener on the bare name is never called and fails silently
 * with no error to notice. `DocumentSheetV2` is the level worth binding: every
 * document sheet inherits it, and it is the first ancestor that has a
 * `.document` to export.
 */
Hooks.on("getHeaderControlsDocumentSheetV2", (app, controls) => {
  const doc = app?.document;
  if (!doc || !game.user.isGM) return;
  // Shown even when the document records no source. An absent button leaves a
  // person wondering whether the module loaded; a button that explains why it
  // cannot work tells them what to do instead, which is to edit a copy
  // imported from a compendium rather than one built from scratch.
  controls.push({
    icon: "fa-solid fa-code-branch",
    label: "Copy graft",
    action: "graftExport",
    onClick: () => copyGraft(doc),
  });
});

async function copyGraft(doc) {
  try {
    const entry = await exportDiff(doc);
    // JSON, because grafts.json is JSON and what you copy should be what you
    // paste. `toYaml` is for the other destination: a vault page's frontmatter.
    const text = JSON.stringify(entry, null, 2);
    await game.clipboard.copyPlainText(text);
    ui.notifications.info(
      Object.keys(entry.patch).length > 0
        ? `Copied a graft for ${doc.name}.`
        : `${doc.name} is unchanged from its source, so the graft is empty.`,
    );
    console.log(`Graft | ${doc.name}\n${text}`);
    console.log(`Graft | as YAML, for a vault page:\n${toYaml(entry)}`);
  } catch (err) {
    ui.notifications.error(`Could not build a graft: ${err.message}`);
  }
}

/**
 * The entries this module ships, from `grafts.json` beside module.json.
 *
 * A file of its own rather than a `flags` block: it is the bulk of what a
 * graft module *is*, and burying a few hundred entries in the manifest would
 * make the manifest unreadable and the entries unreviewable in a diff.
 */
async function readGrafts(moduleId = MODULE_ID) {
  const res = await fetch(`modules/${moduleId}/grafts.json`);
  if (!res.ok) throw new Error(`no grafts.json in modules/${moduleId}/ (HTTP ${res.status})`);
  const parsed = await res.json();
  return Array.isArray(parsed) ? parsed : parsed.entries ?? [];
}

/** Read this module's grafts and build them, reporting what could not be. */
async function buildPacks(moduleId = MODULE_ID) {
  const entries = await readGrafts(moduleId);
  ui.notifications.info(`Building ${entries.length} graft(s)…`);

  const { built, skipped } = await hydrate(moduleId, entries, {
    onProgress: (i, total, entry) => console.log(`Graft | ${i}/${total} ${entry.id}`),
  });

  if (skipped.length > 0) {
    // Named individually in the console, because "3 failed" is not actionable
    // and the reasons differ: a missing dependency and a rejected document
    // want different responses from the reader.
    ui.notifications.warn(`${built.length} built, ${skipped.length} skipped. See the console.`);
    console.warn(`Graft | skipped:`, skipped);
  } else {
    ui.notifications.info(`Built ${built.length} graft(s).`);
  }
  return { built, skipped };
}
