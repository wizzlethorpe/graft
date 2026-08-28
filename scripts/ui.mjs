// Getting a module built without anybody opening a console.
//
// Two entry points, deliberately: one that finds the reader and one the reader
// can find. A module that only builds when prompted is broken the first time
// somebody dismisses the prompt, and a module that only builds from a button
// nobody knows about never gets built at all.

import { hydrate, exportDiff } from "./hydrate.mjs";
import { toYaml } from "./yaml.mjs";

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

/**
 * A "Copy grafts" control on every compendium window.
 *
 * On every one, not only a graft module's own, because the pack an author
 * assembles their work in is an ordinary world compendium: make a pack, drag
 * in the things you have imported and edited and the things you invented, and
 * take the whole array in one go. Doing it a document at a time is the same
 * work done fifty times.
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

/**
 * Export every document in a pack as a grafts array.
 *
 * `getDocuments` fetches the lot, which is why a large pack asks first: a
 * thousand-document compendium is a long wait and rarely what somebody meant
 * to press.
 */
export async function copyPackGrafts(pack) {
  const index = await pack.getIndex();
  if (index.size === 0) {
    ui.notifications.warn(`${pack.title} is empty.`);
    return null;
  }
  // Asked from the index, before `getDocuments` loads the lot, because loading
  // is the expensive part and rarely what somebody meant to press.
  if (index.size > 100 && !await confirmMany(index.size, pack.title)) return null;
  return copyMany(await pack.getDocuments(), pack.title, { confirmed: true });
}

/**
 * Fill in the pack an entry belongs in, when there is only one it could be.
 *
 * `exportDiff` cannot know which module is being authored, but the answer is
 * usually forced: one graft module is enabled and it declares one pack of that
 * document type. Guessing there saves editing every entry by hand.
 *
 * Left out when it is genuinely ambiguous, because a wrong pack fails at build
 * time with a confusing message about types, and a missing one fails with an
 * obvious message about a missing field.
 */
export function withPack(entry) {
  const candidates = [];
  for (const module of graftModules()) {
    for (const pack of module.packs ?? []) {
      if (pack.type === entry.type) candidates.push(pack.name);
    }
  }
  return candidates.length === 1 ? { ...entry, pack: candidates[0] } : entry;
}

async function confirmMany(count, label) {
  return foundry.applications.api.DialogV2.confirm({
    window: { title: "Graft" },
    content: `<p>${label} holds <strong>${count}</strong> documents. Export a graft for every one?</p>`,
  }).catch(() => false);
}

/** One document to the clipboard, as a graft entry. */
export async function copyOne(doc) {
  try {
    const entry = withPack(await exportDiff(doc));
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
    return entry;
  } catch (err) {
    ui.notifications.error(`Could not build a graft: ${err.message}`);
    return null;
  }
}

/**
 * Several documents as one grafts array.
 *
 * One failure does not lose the rest: a reader missing one dependency should
 * still get everything else, and the names of what was skipped.
 */
export async function copyMany(docs, label, { confirmed = false } = {}) {
  if (docs.length === 0) {
    ui.notifications.warn(`${label} has nothing to export.`);
    return null;
  }
  if (!confirmed && docs.length > 100 && !await confirmMany(docs.length, label)) return null;

  const entries = [];
  const failed = [];
  for (const doc of docs) {
    try { entries.push(withPack(await exportDiff(doc))); }
    catch (err) { failed.push(`${doc.name}: ${err.message}`); }
  }

  await game.clipboard.copyPlainText(JSON.stringify(entries, null, 2));
  console.log(`Graft | ${entries.length} entr(ies) from ${label}`,
    JSON.stringify(entries, null, 2));
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

/** Build one module and say what happened, in the console and on screen. */
export async function buildAndReport(moduleId) {
  const entries = await readGrafts(moduleId);
  if (entries.length === 0) {
    ui.notifications.warn(`${moduleId} ships no grafts.json.`);
    return null;
  }

  // No count here. It would be the number declared, and the number attempted is
  // whatever survives planning, so the two disagree in exactly the situation
  // somebody is most likely to be reading carefully. The dialog reports both.
  ui.notifications.info(`Building grafts for ${moduleId}…`);
  const { built, skipped } = await hydrate(moduleId, entries, {
    onProgress: (i, total, entry) => console.log(`Graft | ${i}/${total} ${entry.id}`),
  });

  // Building is the answer to the prompt, so stop suppressing it: if entries
  // go missing later the reader should be asked again.
  const suppressed = new Set(game.settings.get(MODULE_ID, SUPPRESSED));
  if (suppressed.delete(moduleId)) {
    await game.settings.set(MODULE_ID, SUPPRESSED, [...suppressed]);
  }

  // Still logged, because a console line can be copied into a bug report and a
  // dialog cannot. The dialog is what somebody actually reads.
  if (skipped.length > 0) {
    console.group(`Graft | ${skipped.length} skipped`);
    for (const { id, reason } of skipped) console.warn(`${id}: ${reason}`);
    console.groupEnd();
  }
  await reportBuild(moduleId, built, skipped);

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

/**
 * What happened, in a window rather than a notification.
 *
 * "See the console" is a reasonable thing to tell a developer and a poor thing
 * to tell anybody else, and the reasons are the part worth reading: a source
 * that is not installed and an entry that was never valid want different
 * responses, and only one of them is the reader's to fix.
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
    // Collapsed, and after the failures: a successful entry needs no action,
    // and a hundred of them would bury the handful that do.
    const rows = built.map((uuid) => {
      const id = uuid.split(".").pop();
      const pack = game.packs.get(uuid.split(".").slice(1, 3).join("."));
      const name = pack?.index?.get(id)?.name ?? id;
      // The attribute Foundry's click handler actually selects on, so these
      // open the document rather than looking like they might.
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

// ── the world sidebar ───────────────────────────────────────────────────────
//
// A graft is an edit *of* something from a compendium, and you make that edit
// in the world: the actor with the items on it, the scene you have walled. So
// the sidebar is where exporting belongs, and the sheet control is the
// convenience rather than the main road. The compendium menu keeps its own
// purpose, which is chaining onto a pack graft built.

/** Every context hook v14 might fire for a document entry. */
export const CONTEXT_TYPES = [
  "Document", "Actor", "Item", "JournalEntry", "Scene", "RollTable",
  "Macro", "Playlist", "Cards", "Adventure",
];

/**
 * Add "Copy graft" to a directory entry's context menu.
 *
 * Registered for the generic hook and every concrete type, because v14
 * consolidated these and the naming is the same shape as the header-control
 * hooks, where the bare name never fires and does so silently. A hook that
 * never fires costs nothing; the wrong guess costs the feature. Hence the
 * duplicate guard: if two of them do fire for one menu, only one entry lands.
 */
export function addCopyGraftContext(app, menuItems) {
  if (!game.user.isGM || !Array.isArray(menuItems)) return;
  if (menuItems.some((i) => i?.name === "Copy graft")) return;
  menuItems.push({
    name: "Copy graft",
    icon: '<i class="fa-solid fa-code-branch"></i>',
    condition: () => true,
    callback: async (target) => {
      const doc = await documentFromEntry(app, target);
      if (doc) await copyOne(doc);
      else ui.notifications.warn("Graft could not identify that document.");
    },
  });
}

/** And "Copy grafts" on a folder, which is how people actually group work. */
export function addCopyFolderGrafts(app, menuItems) {
  if (!game.user.isGM || !Array.isArray(menuItems)) return;
  if (menuItems.some((i) => i?.name === "Copy grafts")) return;
  menuItems.push({
    name: "Copy grafts",
    icon: '<i class="fa-solid fa-clipboard-list"></i>',
    condition: () => true,
    callback: async (target) => {
      const id = elementOf(target)?.dataset?.folderId;
      const folder = id ? game.folders.get(id) : null;
      if (!folder) return ui.notifications.warn("Graft could not identify that folder.");
      await copyMany(folderContents(folder), folder.name);
    },
  });
}

/** A folder's documents, and its subfolders' documents. */
function folderContents(folder, into = []) {
  for (const doc of folder.contents ?? []) into.push(doc);
  for (const child of folder.children ?? []) folderContents(child.folder ?? child, into);
  return into;
}

/** Context callbacks are handed the list element, jQuery-wrapped in some paths. */
function elementOf(target) {
  return target?.[0] ?? target;
}

async function documentFromEntry(app, target) {
  const el = elementOf(target);
  const id = el?.dataset?.entryId ?? el?.dataset?.documentId;
  if (!id) return null;
  const collection = app?.collection;
  if (!collection) return null;
  return collection.get?.(id) ?? await collection.getDocument?.(id) ?? null;
}
