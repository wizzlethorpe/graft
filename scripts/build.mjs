// One build, whoever starts it: the assets a file names, then the documents, reported as one.

import { placeAssets } from "./assets.mjs";
import * as progress from "./progress.mjs";
import { t } from "./i18n.mjs";

/**
 * Place `assets`, then call `write`, which builds the caller's entries into a module's packs or the world.
 *
 * @returns `{ built, skipped, warnings, removed }`, also sent to `graftBuilt`.
 */
export async function runBuild({ moduleId, title, assets, redownload, write }) {
  progress.begin(`Graft: ${title}`);
  let placed, result;
  try {
    // First: an entry whose source is a file has nothing to resolve until the handler that fetches it has run.
    placed = await placeAssets(assets, { onPhase: progress.phase, onFile: progress.step, redownload });
    result = await write({
      onProgress: (i, total, entry) => {
        if (i === 1) progress.phase(t("GRAFT.PhaseBuilding"), total);
        progress.step(entry.id);
        console.log(`Graft | ${i}/${total} ${entry.id}`);
      },
    });
  } finally {
    progress.end();
  }
  const report = {
    built: result.built,
    skipped: [...placed.skipped, ...result.skipped],
    warnings: [...placed.warnings, ...result.warnings],
    removed: result.removed ?? [],
  };
  // Every build reports, whoever started it. A module tracking what it last
  // built cannot see the pack control or the import dialog from here.
  Hooks.callAll("graftBuilt", moduleId, report);
  return report;
}
