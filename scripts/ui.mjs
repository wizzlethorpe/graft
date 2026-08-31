// Everything on screen: the controls, the menus, the dialogs.
//
// Building has to be reachable two ways. A module that only builds when
// prompted is broken the first time somebody dismisses the prompt, and one that
// only builds from a control nobody has found never gets built at all.

import { hydrate, exportDiff } from "./hydrate.mjs";
import { graftModules, readGrafts, unbuilt, withPack } from "./modules.mjs";
import { registeredProviders, runProviders } from "./providers.mjs";
import * as progress from "./progress.mjs";
import { toYaml } from "./yaml.mjs";
import { importGrafts } from "./import.mjs";

const MODULE_ID = "graft";

/**
 * Localised text.
 *
 * Only what a reader sees. The reasons attached to skipped and warned entries
 * stay as they are: they name ids, UUIDs and package names, and translating the
 * frame around a UUID helps nobody read it.
 */
const t = (key, data) => (data ? game.i18n.format(key, data) : game.i18n.localize(key));
const SUPPRESSED = "suppressedPrompts";
const BULK_CONFIRM_AT = 100;

/** The setting the prompt remembers itself in. */
export function registerSettings() {
  game.settings.register(MODULE_ID, SUPPRESSED, {
    name: "GRAFT.SettingSuppressed",
    scope: "world",
    config: false,
    type: Array,
    default: [],
  });
}

// ── building ────────────────────────────────────────────────────────────────

/**
 * Offer to build anything a newly-enabled module has not built yet.
 *
 * Asked once per module and remembered: a prompt that returns on every world
 * load is one people learn to dismiss without reading. Declining is not
 * permanent, since the pack control is always there.
 */
export async function promptForUnbuilt() {
  if (!game.user.isGM) return;
  const suppressed = new Set(game.settings.get(MODULE_ID, SUPPRESSED));

  for (const module of graftModules()) {
    if (suppressed.has(module.id)) continue;
    const missing = await unbuilt(module.id);
    if (missing.length === 0) continue;

    const build = await foundry.applications.api.DialogV2.confirm({
      window: { title: t("GRAFT.PromptTitle", { module: module.title }) },
      content: t("GRAFT.PromptBody", { module: module.title, count: missing.length }) + providerNotice(),
      yes: { label: t("GRAFT.PromptBuild") },
      no: { label: t("GRAFT.PromptLater") },
      modal: false,
    }).catch(() => false);

    if (build) await buildAndReport(module.id);
    else {
      suppressed.add(module.id);
      await game.settings.set(MODULE_ID, SUPPRESSED, [...suppressed]);
    }
  }
}

/** Build one module and say what happened, on screen and in the console. */
export async function buildAndReport(moduleId) {
  const entries = await readGrafts(moduleId);
  if (entries.length === 0) {
    ui.notifications.warn(t("GRAFT.NoEntries", { module: moduleId }));
    return null;
  }

  const title = game.modules.get(moduleId)?.title ?? moduleId;
  progress.begin(`Graft: ${title}`);
  let prepared, built, skipped, warnings, removed;
  try {
    // Providers rewrite entries before anything is built. Their failures use
    // the same shape as build failures, so the reader sees one report.
    prepared = await runProviders(entries, undefined, {
      onProvider: (p) => progress.phase(p.label),
    });
    ({ built, skipped, warnings, removed } = await hydrate(moduleId, prepared.entries, {
      // A provider that skipped an entry drops it from its output; the entry
      // still exists, and what was built for it last time is not stale.
      declared: entries,
      // The total is only known once planning has dropped what it cannot
      // build, which is the first thing the callback is told.
      onProgress: (i, total, entry) => {
        if (i === 1) progress.phase(t("GRAFT.PhaseBuilding"), total);
        progress.step(entry.id);
        console.log(`Graft | ${i}/${total} ${entry.id}`);
      },
    }));
  } finally {
    progress.end();
  }
  const allSkipped = [...prepared.skipped, ...skipped];
  const allWarnings = [...prepared.warnings, ...warnings];

  // Building answers the prompt, so stop suppressing it: if entries go missing
  // later the reader should be asked again.
  const suppressed = new Set(game.settings.get(MODULE_ID, SUPPRESSED));
  if (suppressed.delete(moduleId)) {
    await game.settings.set(MODULE_ID, SUPPRESSED, [...suppressed]);
  }

  // Every build reports, whoever started it. A module tracking what it last
  // built cannot see the pack control or the compendium header from here.
  Hooks.callAll("graftBuilt", moduleId, { built, skipped: allSkipped, warnings: allWarnings, removed });

  // Logged as well as shown, because a console line can go into a bug report.
  if (removed.length > 0) {
    console.group(`Graft | ${removed.length} removed`);
    for (const { id, name, pack } of removed) console.log(`${name} (${id}) from ${pack}`);
    console.groupEnd();
  }
  if (allWarnings.length > 0) {
    console.group(`Graft | ${allWarnings.length} built with warnings`);
    for (const { provider, id, reason } of allWarnings) {
      console.warn(`${provider ? `[${provider}] ` : ""}${id}: ${reason}`);
    }
    console.groupEnd();
  }
  if (allSkipped.length > 0) {
    console.group(`Graft | ${allSkipped.length} skipped`);
    for (const { provider, id, reason } of allSkipped) {
      console.warn(`${provider ? `[${provider}] ` : ""}${id}: ${reason}`);
    }
    console.groupEnd();
  }
  await reportBuild(moduleId, built, allSkipped, allWarnings, removed);
  return { built, skipped: allSkipped, warnings: allWarnings, removed };
}

/** Build failures first, then each provider's, each under its own heading. */
function groupByProvider(skipped) {
  const labels = new Map(registeredProviders().map((p) => [p.id, p.label]));
  const groups = new Map();
  for (const item of skipped) {
    const key = item.provider ? labels.get(item.provider) ?? item.provider : null;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  // Nulls first: a build failure is graft's own, and reads oddly after a
  // section named for somebody else.
  return [...groups].sort((a, b) => (a[0] === null ? -1 : b[0] === null ? 1 : 0));
}

/** Said only when there is something to say, so it stays worth reading. */
function providerNotice() {
  const names = registeredProviders().map((p) => p.label);
  if (names.length === 0) return t("GRAFT.PromptNoDownload");
  return t("GRAFT.PromptProviders", { providers: names.join(", ") });
}

/**
 * What happened, in a window rather than a notification.
 *
 * The reasons are the part worth reading: a missing dependency and an invalid
 * entry want different responses, and only one is the reader's to fix.
 */
async function reportBuild(moduleId, built, skipped, warnings = [], removed = []) {
  const title = game.modules.get(moduleId)?.title ?? moduleId;
  const parts = [
    `<p>${t("GRAFT.ReportBuilt", { count: built.length })}`
    + (skipped.length ? t("GRAFT.ReportNotBuilt", { count: skipped.length }) : "")
    + (removed.length ? t("GRAFT.ReportRemoved", { count: removed.length }) : "")
    + `.</p>`,
  ];

  if (removed.length > 0) {
    // Named rather than counted: a document disappearing from somebody's pack
    // should say what it was.
    const rows = removed.map(({ name, pack }) =>
      `<li>${foundry.utils.escapeHTML(name)} <span class="notes">${foundry.utils.escapeHTML(pack)}</span></li>`).join("");
    parts.push(`<p><strong>${t("GRAFT.SectionRemoved")}</strong></p><ul>${rows}</ul>`);
  }

  // Sectioned by whoever reported it. A provider failing to reach a service and
  // an entry that was never valid want different responses from the reader, and
  // one undifferentiated list hides which is which.
  for (const [provider, items] of groupByProvider(skipped)) {
    const rows = items.map(({ id, reason }) =>
      `<li><code>${foundry.utils.escapeHTML(id)}</code><br>`
      + `<span class="notes">${foundry.utils.escapeHTML(reason)}</span></li>`).join("");
    const heading = provider
      ? t("GRAFT.SectionNotBuiltBy", { provider: foundry.utils.escapeHTML(provider) })
      : t("GRAFT.SectionNotBuilt");
    parts.push(`<p><strong>${heading}</strong></p><ul>${rows}</ul>`);
  }

  if (warnings.length > 0) {
    // Built, but not necessarily as intended. Between the failures and the
    // successes, because that is what they are.
    const rows = warnings.map(({ id, reason }) =>
      `<li><code>${foundry.utils.escapeHTML(id)}</code><br>`
      + `<span class="notes">${foundry.utils.escapeHTML(reason)}</span></li>`).join("");
    parts.push(`<p><strong>${t("GRAFT.SectionWarnings")}</strong></p><ul>${rows}</ul>`);
  }

  if (built.length > 0) {
    // Collapsed and last: a successful entry needs no action, and a hundred of
    // them would bury the few that do.
    const rows = built.map((uuid) => {
      const id = uuid.split(".").pop();
      const pack = game.packs.get(uuid.split(".").slice(1, 3).join("."));
      const name = pack?.index?.get(id)?.name ?? id;
      // `data-link` is what Foundry's click handler selects on; the class is
      // only styling.
      return `<li><a class="content-link" data-link draggable="true" data-uuid="${uuid}">`
        + `${foundry.utils.escapeHTML(name)}</a></li>`;
    }).join("");
    parts.push(`<details><summary>${t("GRAFT.SectionSuccess", { count: built.length })}</summary><ul>${rows}</ul></details>`);
  }

  await foundry.applications.api.DialogV2.prompt({
    window: { title: `Graft: ${title}` },
    content: `<div style="max-height:24rem;overflow:auto">${parts.join("")}</div>`,
    ok: { label: t("GRAFT.Close") },
    position: { width: 520 },
  }).catch(() => {});
}

// ── copying ─────────────────────────────────────────────────────────────────

/** One document to the clipboard, as a graft entry. */
export async function copyOne(doc) {
  try {
    const entry = withPack(await exportDiff(doc));
    // JSON, because grafts.json is JSON and what you copy should be what you
    // paste. YAML is for the other destination, a vault page's frontmatter.
    const text = JSON.stringify(entry, null, 2);
    await game.clipboard.copyPlainText(text);
    ui.notifications.info(
      Object.keys(entry.patch).length > 0
        ? t("GRAFT.Copied", { name: doc.name })
        : t("GRAFT.CopiedUnchanged", { name: doc.name }),
    );
    console.log(`Graft | ${doc.name}\n${text}`);
    console.log(`Graft | as YAML, for a vault page:\n${toYaml(entry)}`);
    return entry;
  } catch (err) {
    ui.notifications.error(t("GRAFT.CopyFailed", { reason: err.message }));
    return null;
  }
}

/**
 * Several documents as one grafts array.
 *
 * One failure does not lose the rest; the names of what was skipped go to the
 * console.
 */
/** Grafts for a set of documents, and the names of any that would not build. */
async function graftsFor(docs) {
  const entries = [];
  const failed = [];
  for (const doc of docs) {
    try { entries.push(withPack(await exportDiff(doc))); }
    catch (err) { failed.push(`${doc.name}: ${err.message}`); }
  }
  return { entries, failed };
}

/** Foundry moved this under `foundry.utils`; older worlds still have the global. */
const saveJson = (text, filename) =>
  (foundry.utils?.saveDataToFile ?? globalThis.saveDataToFile)(text, "application/json", filename);

/** A filename from whatever the thing was called, safe on every filesystem. */
function fileName(label) {
  const stem = String(label ?? "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  return `${stem || "grafts"}.grafts.json`;
}

/**
 * Download the same entries Copy would have put on the clipboard.
 *
 * Always an array, even for one document: a file is a thing on its own, and
 * the only shape that is a `grafts.json` a module can ship or an import can
 * read is the list.
 */
export async function downloadGrafts(docs, label) {
  if (docs.length === 0) {
    ui.notifications.warn(t("GRAFT.NothingToExport", { label }));
    return null;
  }
  const { entries, failed } = await graftsFor(docs);
  saveJson(JSON.stringify(entries, null, 2), fileName(label));
  reportExport(entries, failed, label, "GRAFT.Downloaded", "GRAFT.DownloadedSkipped");
  return entries;
}

/** What was written, and what would not build, on screen and in the console. */
function reportExport(entries, failed, label, okKey, skippedKey) {
  console.log(`Graft | ${entries.length} entr(ies) from ${label}`, JSON.stringify(entries, null, 2));
  if (failed.length > 0) {
    console.group(`Graft | ${failed.length} could not be exported`);
    for (const f of failed) console.warn(f);
    console.groupEnd();
  }
  ui.notifications.info(failed.length
    ? t(skippedKey, { count: entries.length, label, failed: failed.length })
    : t(okKey, { count: entries.length, label }));
}

export async function copyMany(docs, label) {
  if (docs.length === 0) {
    ui.notifications.warn(t("GRAFT.NothingToExport", { label }));
    return null;
  }
  const { entries, failed } = await graftsFor(docs);

  await game.clipboard.copyPlainText(JSON.stringify(entries, null, 2));
  reportExport(entries, failed, label, "GRAFT.CopiedMany", "GRAFT.CopiedManySkipped");
  return entries;
}

/** Confirm before a bulk export large enough that nobody meant to press it. */
async function confirmBulk(count, label) {
  if (count <= BULK_CONFIRM_AT) return true;
  return foundry.applications.api.DialogV2.confirm({
    window: { title: "Graft" },
    content: t("GRAFT.ConfirmBulk", { label, count }),
  }).catch(() => false);
}

// ── importing a file ────────────────────────────────────────────────────────

/**
 * Ask for a file and a name, then build it into world compendiums.
 *
 * A file rather than a module, for content somebody sent you. What it builds
 * is not tracked: there is no manifest to compare against later, so this is an
 * import, not a subscription.
 */
export async function promptForImport() {
  if (!game.user.isGM) return null;
  const picked = await foundry.applications.api.DialogV2.prompt({
    window: { title: t("GRAFT.ImportTitle") },
    content: `<p>${t("GRAFT.ImportIntro")}</p>
      <div class="form-group"><label>${t("GRAFT.ImportName")}</label>
        <input name="label" type="text" placeholder="${t("GRAFT.ImportNamePlaceholder")}"></div>
      <div class="form-group"><label>${t("GRAFT.ImportFile")}</label>
        <input name="file" type="file" accept="application/json,.json"></div>`,
    ok: {
      label: t("GRAFT.ImportBuild"),
      callback: (_event, button) => ({
        label: button.form.elements.label.value.trim(),
        file: button.form.elements.file.files?.[0] ?? null,
      }),
    },
    rejectClose: false,
  });
  if (!picked?.file) return null;

  let parsed;
  try { parsed = JSON.parse(await picked.file.text()); }
  catch (err) {
    ui.notifications.error(t("GRAFT.ImportUnreadable", { reason: err.message }));
    return null;
  }

  const label = picked.label || picked.file.name.replace(/\.(grafts\.)?json$/i, "");
  try {
    const result = await importGrafts(parsed, label);
    // No module to name, so the report is titled with what the reader called it.
    await reportBuild(label, result.built, result.skipped, result.warnings, result.removed);
    return result;
  } catch (err) {
    ui.notifications.error(t("GRAFT.ImportFailed", { reason: err.message }));
    return null;
  }
}

/** A Build from file control on the Compendium tab, where imports would be looked for. */
export function addImportControl(app, html) {
  if (!game.user.isGM) return;
  const root = html?.[0] ?? html ?? app?.element;
  if (!root?.querySelector || root.querySelector("[data-graft-import]")) return;
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.graftImport = "";
  button.innerHTML = `<i class="fa-solid fa-code-branch"></i> ${t("GRAFT.ImportControl")}`;
  button.addEventListener("click", (event) => { event.preventDefault(); promptForImport(); });
  (root.querySelector(".directory-header") ?? root.querySelector("header") ?? root).append(button);
}

// ── compendium controls ─────────────────────────────────────────────────────

/** A Build control on a graft module's own packs, where an empty one is noticed. */
export function addPackControl(app, controls) {
  const moduleId = app?.collection?.metadata?.packageName;
  if (!game.user.isGM || !moduleId) return;
  if (!graftModules().some((m) => m.id === moduleId)) return;
  controls.push({
    icon: "fa-solid fa-code-branch",
    label: t("GRAFT.BuildControl"),
    action: "graftBuild",
    onClick: () => buildAndReport(moduleId),
  });
}

// ── world sidebar ───────────────────────────────────────────────────────────
//
// Where a graft is actually made: you edit the actor with the items on it, or
// the scene you have walled, and that edit is the graft. The sheet control is
// the convenience for something already open; the compendium controls are for
// chaining onto a pack graft built.

/**
 * Types whose directory context menu gets a Copy graft entry.
 *
 * Concrete types only. The API docs name a generic `getDocumentContextOptions`,
 * but modules that visibly work in this version bind the per-type name, and a
 * working module beats documentation that also got the argument list wrong.
 */
export const CONTEXT_TYPES = [
  "Actor", "Item", "JournalEntry", "Scene", "RollTable",
  "Macro", "Playlist", "Cards", "Adventure",
];

/**
 * Add Copy graft to a directory entry's context menu.
 *
 * The hook's first argument is the rendered HTML rather than the application,
 * so the type is passed in: an element's id cannot say which collection it
 * belongs to.
 */
export function addCopyGraftContext(documentName, menuItems) {
  if (!game.user.isGM || !Array.isArray(menuItems)) return;
  if (menuItems.some((i) => i?.name === t("GRAFT.CopyOne"))) return;
  menuItems.push({
    name: t("GRAFT.CopyOne"),
    icon: '<i class="fa-solid fa-code-branch"></i>',
    callback: async (target) => {
      const el = elementOf(target);
      const id = el?.dataset?.documentId ?? el?.dataset?.entryId;
      const doc = id ? game.collections.get(documentName)?.get(id) : null;
      if (doc) await copyOne(doc);
      else ui.notifications.warn(t("GRAFT.NoDocument"));
    },
  });
  menuItems.push({
    name: t("GRAFT.ExportOne"),
    icon: '<i class="fa-solid fa-file-arrow-down"></i>',
    callback: async (target) => {
      const el = elementOf(target);
      const id = el?.dataset?.documentId ?? el?.dataset?.entryId;
      const doc = id ? game.collections.get(documentName)?.get(id) : null;
      if (doc) await downloadGrafts([doc], doc.name);
      else ui.notifications.warn(t("GRAFT.NoDocument"));
    },
  });
}

/** And Copy grafts on a folder, which is how people group work. */
export function addCopyFolderGrafts(html, menuItems) {
  if (!game.user.isGM || !Array.isArray(menuItems)) return;
  if (menuItems.some((i) => i?.name === t("GRAFT.CopyMany"))) return;
  menuItems.push({
    name: t("GRAFT.CopyMany"),
    icon: '<i class="fa-solid fa-clipboard-list"></i>',
    callback: async (target) => {
      const el = elementOf(target);
      const folder = folderFrom(el);
      // World folders only. Copying runs one way on purpose: the world is where
      // you build, the compendium is where graft puts things.
      if (folder && (folder.pack || folder.type === "Compendium")) {
        return ui.notifications.warn(
          t("GRAFT.WorldOnly"));
      }
      if (!folder) {
        // The dataset is logged because which attribute this version uses is
        // invisible from a notification.
        console.warn("Graft | could not identify a folder from", el,
          "dataset:", el?.dataset ? { ...el.dataset } : el);
        return ui.notifications.warn(t("GRAFT.NoFolder"));
      }
      const docs = folderContents(folder);
      if (await confirmBulk(docs.length, folder.name)) await copyMany(docs, folder.name);
    },
  });
  menuItems.push({
    name: t("GRAFT.ExportMany"),
    icon: '<i class="fa-solid fa-file-arrow-down"></i>',
    callback: async (target) => {
      const folder = folderFrom(elementOf(target));
      if (folder && (folder.pack || folder.type === "Compendium")) {
        return ui.notifications.warn(t("GRAFT.WorldOnly"));
      }
      if (!folder) return ui.notifications.warn(t("GRAFT.NoFolder"));
      const docs = folderContents(folder);
      if (await confirmBulk(docs.length, folder.name)) await downloadGrafts(docs, folder.name);
    },
  });
}

/**
 * A folder's documents, and its subfolders'.
 *
 * `getSubfolders(true)` rather than `children`, which holds tree nodes rather
 * than Folder documents.
 */
function folderContents(folder) {
  return [folder, ...folder.getSubfolders(true)].flatMap((f) => f.contents ?? []);
}

/** Callbacks are handed the list element, jQuery-wrapped on some paths. */
function elementOf(target) {
  return target?.[0] ?? target;
}

/**
 * The folder a context menu was opened on.
 *
 * Every plausible spelling and a walk up the tree: the directory markup is
 * undocumented, and the element handed to a callback is not necessarily the one
 * carrying the id.
 */
function folderFrom(el) {
  if (!el) return null;
  const d = el.dataset ?? {};
  const uuid = typeof d.uuid === "string" && d.uuid.startsWith("Folder.") ? d.uuid.slice(7) : null;
  const id = d.folderId ?? d.entryId ?? d.documentId ?? uuid
    ?? el.closest?.("[data-folder-id]")?.dataset?.folderId
    ?? el.closest?.("[data-entry-id]")?.dataset?.entryId;
  return id ? game.folders.get(id) ?? null : null;
}
