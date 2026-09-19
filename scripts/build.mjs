// One build, whoever starts it: the assets a file names, then other modules'
// transforms, then the documents, reported as one.

import { placeAssets } from "./assets.mjs";
import { collectTransforms, runTransforms } from "./extend.mjs";
import { refuseInvalid } from "./plan.mjs";
import * as progress from "./progress.mjs";
import { t } from "./i18n.mjs";

/**
 * Place `assets`, run `moduleId`'s transforms over `entries`, and hand what
 * they produce to `write`, which builds into a module's packs or the world.
 *
 * @returns `{ built, skipped, warnings, removed }`, also sent to `graftBuilt`.
 */
export async function runBuild({ moduleId, title, assets, entries, redownload, write }) {
  progress.begin(`Graft: ${title}`);
  let placed, prepared, result;
  // Before any transform sees them: a transform may fetch for an entry, and one graft will not build must not cost a download.
  const { sound, refused } = refuseInvalid(entries);
  try {
    // Before transforms: an entry whose source is a file has nothing to
    // resolve until the handler that fetches it has run.
    placed = await placeAssets(assets, { onPhase: progress.phase, onFile: progress.step, redownload });
    prepared = await runTransforms(collectTransforms(moduleId), sound, {
      onTransform: (tr) => progress.phase(tr.label),
    });
    result = await write(prepared.entries, {
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
    skipped: [...refused, ...placed.skipped, ...prepared.skipped, ...result.skipped],
    warnings: [...placed.warnings, ...prepared.warnings, ...result.warnings],
    removed: result.removed ?? [],
  };
  // Every build reports, whoever started it. A module tracking what it last
  // built cannot see the pack control or the import dialog from here.
  Hooks.callAll("graftBuilt", moduleId, report);
  return report;
}
