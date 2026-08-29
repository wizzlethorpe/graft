// Everything on screen: the controls, the menus, the dialogs.
//
// Building has to be reachable two ways. A module that only builds when
// prompted is broken the first time somebody dismisses the prompt, and one that
// only builds from a control nobody has found never gets built at all.

import { hydrate, exportDiff } from "./hydrate.mjs";
import { graftModules, readGrafts, unbuilt, withPack } from "./modules.mjs";
import { toYaml } from "./yaml.mjs";

const MODULE_ID = "graft";
const SUPPRESSED = "suppressedPrompts";
const BULK_CONFIRM_AT = 100;

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

/** Build one module and say what happened, on screen and in the console. */
export async function buildAndReport(moduleId) {
  const entries = await readGrafts(moduleId);
  if (entries.length === 0) {
    ui.notifications.warn(`${moduleId} declares no graft entries.`);
    return null;
  }

  // No count: this would be the number declared, and progress reports the
  // number that survived planning. The dialog gives both, accurately.
  ui.notifications.info(`Building grafts for ${moduleId}…`);
  const { built, skipped } = await hydrate(moduleId, entries, {
    onProgress: (i, total, entry) => console.log(`Graft | ${i}/${total} ${entry.id}`),
  });

  // Building answers the prompt, so stop suppressing it: if entries go missing
  // later the reader should be asked again.
  const suppressed = new Set(game.settings.get(MODULE_ID, SUPPRESSED));
  if (suppressed.delete(moduleId)) {
    await game.settings.set(MODULE_ID, SUPPRESSED, [...suppressed]);
  }

  // Logged as well as shown, because a console line can go into a bug report.
  if (skipped.length > 0) {
    console.group(`Graft | ${skipped.length} skipped`);
    for (const { id, reason } of skipped) console.warn(`${id}: ${reason}`);
    console.groupEnd();
  }
  await reportBuild(moduleId, built, skipped);
  return { built, skipped };
}

/**
 * What happened, in a window rather than a notification.
 *
 * The reasons are the part worth reading: a missing dependency and an invalid
 * entry want different responses, and only one is the reader's to fix.
 */
async function reportBuild(moduleId, built, skipped) {
  const title = game.modules.get(moduleId)?.title ?? moduleId;
  const parts = [
    `<p><strong>${built.length}</strong> built`
    + (skipped.length ? `, <strong>${skipped.length}</strong> not built` : "")
    + `.</p>`,
  ];

  if (skipped.length > 0) {
    const rows = skipped.map(({ id, reason }) =>
      `<li><code>${foundry.utils.escapeHTML(id)}</code><br>`
      + `<span class="notes">${foundry.utils.escapeHTML(reason)}</span></li>`).join("");
    parts.push(`<p><strong>Not built</strong></p><ul>${rows}</ul>`);
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
    parts.push(`<details><summary>${built.length} built</summary><ul>${rows}</ul></details>`);
  }

  await foundry.applications.api.DialogV2.prompt({
    window: { title: `Graft: ${title}` },
    content: `<div style="max-height:24rem;overflow:auto">${parts.join("")}</div>`,
    ok: { label: "Close" },
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
        ? `Copied a graft for ${doc.name}.`
        : `${doc.name} is unchanged from its source, so the graft is empty.`,
    );
    console.log(`Graft | ${doc.name}\n${text}`);
    console.log(`Graft | as YAML, for a vault page:\n${toYaml(entry)}`);
    return entry;
  } catch (err) {
    ui.notifications.error(`Could not build a graft: ${err.message}`);
    return null;
  }
}

/**
 * Several documents as one grafts array.
 *
 * One failure does not lose the rest; the names of what was skipped go to the
 * console.
 */
export async function copyMany(docs, label) {
  if (docs.length === 0) {
    ui.notifications.warn(`${label} has nothing to export.`);
    return null;
  }
  const entries = [];
  const failed = [];
  for (const doc of docs) {
    try { entries.push(withPack(await exportDiff(doc))); }
    catch (err) { failed.push(`${doc.name}: ${err.message}`); }
  }

  await game.clipboard.copyPlainText(JSON.stringify(entries, null, 2));
  console.log(`Graft | ${entries.length} entr(ies) from ${label}`, JSON.stringify(entries, null, 2));
  if (failed.length > 0) {
    console.group(`Graft | ${failed.length} could not be exported`);
    for (const f of failed) console.warn(f);
    console.groupEnd();
  }
  ui.notifications.info(
    `Copied ${entries.length} graft(s) from ${label}`
    + (failed.length ? `, ${failed.length} skipped. See the console.` : "."),
  );
  return entries;
}

/** Confirm before a bulk export large enough that nobody meant to press it. */
async function confirmBulk(count, label) {
  if (count <= BULK_CONFIRM_AT) return true;
  return foundry.applications.api.DialogV2.confirm({
    window: { title: "Graft" },
    content: `<p>${label} holds <strong>${count}</strong> documents. Export a graft for every one?</p>`,
  }).catch(() => false);
}

/** Every document in a pack. Asked from the index, before loading the lot. */
export async function copyPackGrafts(pack) {
  const index = await pack.getIndex();
  if (index.size === 0) {
    ui.notifications.warn(`${pack.title} is empty.`);
    return null;
  }
  if (!await confirmBulk(index.size, pack.title)) return null;
  return copyMany(await pack.getDocuments(), pack.title);
}

// ── compendium controls ─────────────────────────────────────────────────────

/** A Build control on a graft module's own packs, where an empty one is noticed. */
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

/**
 * A Copy grafts control on every compendium, not only a graft module's own.
 *
 * The pack an author assembles their work in is an ordinary world compendium,
 * and taking the array in one go beats doing it fifty times.
 */
export function addCopyControl(app, controls) {
  const pack = app?.collection;
  if (!game.user.isGM || !pack) return;
  controls.push({
    icon: "fa-solid fa-clipboard-list",
    label: "Copy grafts",
    action: "graftCopyAll",
    onClick: () => copyPackGrafts(pack),
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
 * but Item Piles binds `getActorContextOptions` per type and visibly works,
 * which beats documentation that also got the argument list wrong.
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
  if (menuItems.some((i) => i?.name === "Copy graft")) return;
  menuItems.push({
    name: "Copy graft",
    icon: '<i class="fa-solid fa-code-branch"></i>',
    callback: async (target) => {
      const el = elementOf(target);
      const id = el?.dataset?.documentId ?? el?.dataset?.entryId;
      const doc = id ? game.collections.get(documentName)?.get(id) : null;
      if (doc) await copyOne(doc);
      else ui.notifications.warn("Graft could not identify that document.");
    },
  });
}

/** And Copy grafts on a folder, which is how people group work. */
export function addCopyFolderGrafts(html, menuItems) {
  if (!game.user.isGM || !Array.isArray(menuItems)) return;
  if (menuItems.some((i) => i?.name === "Copy grafts")) return;
  menuItems.push({
    name: "Copy grafts",
    icon: '<i class="fa-solid fa-clipboard-list"></i>',
    callback: async (target) => {
      const el = elementOf(target);
      const folder = folderFrom(el);
      if (!folder) {
        // The dataset is logged because which attribute this version uses is
        // invisible from a notification.
        console.warn("Graft | could not identify a folder from", el,
          "dataset:", el?.dataset ? { ...el.dataset } : el);
        return ui.notifications.warn("Graft could not identify that folder.");
      }
      const docs = folderContents(folder);
      if (await confirmBulk(docs.length, folder.name)) await copyMany(docs, folder.name);
    },
  });
}

/** A folder's documents, and its subfolders'. */
function folderContents(folder, into = []) {
  for (const doc of folder.contents ?? []) into.push(doc);
  for (const child of folder.children ?? []) folderContents(child.folder ?? child, into);
  return into;
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
