// Where Foundry calls in, and nothing else.

import { stampOrigin } from "./origin.mjs";
import { hydrate, exportDiff } from "./hydrate.mjs";
import { readGrafts, unbuilt, anyBuilt } from "./modules.mjs";
import { registerProvider, registeredProviders } from "./providers.mjs";
import * as progress from "./progress.mjs";
import { moulinetteProvider } from "./moulinette.mjs";
import {
  registerSettings, promptForUnbuilt, addPackControl, copyOne,
  buildAndReport, addCopyGraftContext, addCopyFolderGrafts, addImportControl, CONTEXT_TYPES,
} from "./ui.mjs";

const MODULE_ID = "graft";

Hooks.once("init", () => {
  registerSettings();
  game.modules.get(MODULE_ID).api = {
    hydrate, exportDiff, readGrafts, unbuilt, anyBuilt, buildPacks: buildAndReport,
    registerProvider, registeredProviders,
    progress: { phase: progress.phase, step: progress.step, note: progress.note },
  };
});

// Offers to build anything an enabled graft module has not built yet. Once per
// module, remembered, because a prompt on every world load is one people learn
// to dismiss without reading.
// Providers register here rather than at init, so they never have to care
// whether their own module loaded before this one.
Hooks.once("ready", async () => {
  // Shipped with graft but inert without Moulinette, so a reader who does not
  // use it never sees it named in a build prompt.
  if (game.modules.get("moulinette")?.active) registerProvider(moulinetteProvider());
  Hooks.callAll("graftRegisterProviders", { registerProvider });
  await promptForUnbuilt();
});

// A Build control in the header of a graft module's own compendium windows,
// which is where somebody looks when they wonder why a pack is empty.
Hooks.on("getHeaderControlsCompendium", addPackControl);
Hooks.on("renderCompendiumDirectory", addImportControl);

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
Hooks.on("preImportAdventure", (adventure, formData, toCreate) => {
  stampOrigin(adventure, toCreate);
});


// The world sidebar, where a graft is actually made. The type is bound rather
// than derived: the hook hands over HTML, and an element's id cannot say which
// collection it belongs to.
for (const type of CONTEXT_TYPES) {
  Hooks.on(`get${type}ContextOptions`, (html, menuItems) => addCopyGraftContext(type, menuItems));
}

Hooks.on("getFolderContextOptions", addCopyFolderGrafts);
