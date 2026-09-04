// Where Foundry calls in, and nothing else.

import { stampOrigin } from "./origin.mjs";
import { hydrate, exportDiff, resolveData } from "./hydrate.mjs";
import { readGrafts, unbuilt, anyBuilt } from "./modules.mjs";
import * as progress from "./progress.mjs";
import {
  registerSettings, promptForUnbuilt, addPackControl, copyOne,
  buildAndReport, addCopyGraftContext, addCopyFolderGrafts, addImportControl, CONTEXT_TYPES,
} from "./ui.mjs";

const MODULE_ID = "graft";

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = {
    hydrate, exportDiff, resolve: resolveData, readGrafts, unbuilt, anyBuilt, buildPacks: buildAndReport,
    progress: { phase: progress.phase, step: progress.step, note: progress.note },
  };
});

Hooks.once("ready", promptForUnbuilt);

// A Build control in the header of a graft module's own compendium windows,
// which is where somebody looks when they wonder why a pack is empty.
Hooks.on("getHeaderControlsCompendium", addPackControl);
// Importing grafts spans document types, so its control is on the Settings tab.
Hooks.on("renderSettings", addImportControl);

/**
 * Copy graft on every document sheet: the convenience path for something
 * already open. The sidebar menu below is the main road.
 *
 * ApplicationV2 fires `getHeaderControls` + a class name, once per class in the
 * inheritance chain, so binding the bare name is never called and fails
 * silently. `DocumentSheetV2` is the first ancestor with a `.document`.
 */
Hooks.on("getHeaderControlsDocumentSheetV2", (app, controls) => {
  const doc = app?.document;
  if (!doc || !game.user.isGM) return;
  // Shown even with no recorded source: a button that explains why it cannot
  // work beats an absent one nobody can tell is absent.
  controls.push({
    icon: "fa-solid fa-code-branch",
    label: "Copy graft",
    action: "graftExport",
    onClick: () => copyOne(doc),
  });
});

// Adventure import is the one path that carries a publisher's own provenance
// into your world verbatim, so this is the moment to record something true.
Hooks.on("preImportAdventure", (adventure, formData, toCreate, toUpdate) => {
  stampOrigin(adventure, toCreate, toUpdate);
});


// The world sidebar, where a graft is actually made. The type is bound rather
// than derived: the hook hands over HTML, and an element's id cannot say which
// collection it belongs to.
for (const type of CONTEXT_TYPES) {
  Hooks.on(`get${type}ContextOptions`, (html, menuItems) => addCopyGraftContext(type, menuItems));
}

Hooks.on("getFolderContextOptions", addCopyFolderGrafts);
