// Module entry point: the hooks, and nothing else. What they do lives in
// hydrate.mjs (building), ui.mjs (asking and reporting) and patch.mjs (the
// format), so this file stays a list of where Foundry calls in.

import { hydrate, exportDiff } from "./hydrate.mjs";
import { toYaml } from "./yaml.mjs";
import {
  registerSettings, promptForUnbuilt, addPackControl, buildAndReport, readGrafts, unbuilt,
} from "./ui.mjs";

const MODULE_ID = "graft";

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = {
    hydrate, exportDiff, readGrafts, unbuilt, buildPacks: buildAndReport,
  };
});

// Offers to build anything an enabled graft module has not built yet. Once per
// module, remembered, because a prompt on every world load is one people learn
// to dismiss without reading.
Hooks.once("ready", () => promptForUnbuilt());

// A Build control in the header of a graft module's own compendium windows,
// which is where somebody looks when they wonder why a pack is empty.
Hooks.on("getHeaderControlsCompendium", addPackControl);

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

