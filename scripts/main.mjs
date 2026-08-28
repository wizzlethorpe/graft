// Module entry point: the hooks, and nothing else. What they do lives in
// hydrate.mjs (building), ui.mjs (asking and reporting) and patch.mjs (the
// format), so this file stays a list of where Foundry calls in.

import { stampOrigin } from "./origin.mjs";
import { hydrate, exportDiff } from "./hydrate.mjs";
import {
  registerSettings, promptForUnbuilt, addPackControl, addCopyControl, copyOne,
  copyPackGrafts, buildAndReport, readGrafts, unbuilt,
  addCopyGraftContext, addCopyFolderGrafts, CONTEXT_TYPES,
} from "./ui.mjs";

const MODULE_ID = "graft";

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = {
    hydrate, exportDiff, readGrafts, unbuilt, buildPacks: buildAndReport,
    copyPackGrafts,
  };
});

// Offers to build anything an enabled graft module has not built yet. Once per
// module, remembered, because a prompt on every world load is one people learn
// to dismiss without reading.
Hooks.once("ready", () => promptForUnbuilt());

// A Build control in the header of a graft module's own compendium windows,
// which is where somebody looks when they wonder why a pack is empty.
Hooks.on("getHeaderControlsCompendium", (app, controls) => {
  addPackControl(app, controls);
  // Every compendium, not only a graft module's own: the pack an author
  // assembles their work in is an ordinary world compendium.
  addCopyControl(app, controls);
});

/**
 * A "Copy graft" control on every document sheet.
 *
 * The convenience path, for a document already open in front of you. The
 * sidebar context menu below is the main road.
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
    onClick: () => copyOne(doc),
  });
});

// Adventure import is the one path that carries a publisher's own provenance
// into your world verbatim, so this is the moment to record something true.
Hooks.on("preImportAdventure", (adventure, formData, toCreate) => {
  stampOrigin(adventure, toCreate);
});


// The world sidebar, which is where a graft is actually made: you edit the
// actor with the items on it, or the scene you have walled, and the edit *is*
// the graft. The sheet control is the convenience for a document already open;
// this is the main road.
//
// Registered for the generic hook and every concrete type. v14 consolidated
// these into `getDocumentContextOptions` with per-type variants, and this is
// the same naming shape as the header-control hooks, where binding the bare
// name fires nothing and does so silently. `addCopyGraftContext` de-duplicates,
// so a type that fires both hooks still gets one entry.
for (const type of CONTEXT_TYPES) {
  // The type is bound rather than derived, because the hook hands over HTML
  // and the element alone cannot say which collection its id belongs to.
  Hooks.on(`get${type}ContextOptions`, (html, menuItems) => addCopyGraftContext(type, menuItems));
}

// Folders group the work, so exporting one is the bulk case that matches how
// people organise rather than how the data happens to be stored.
Hooks.on("getFolderContextOptions", addCopyFolderGrafts);
