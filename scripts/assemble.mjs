// Folding built entries into one Adventure, for a pack declared as one.
//
// No Foundry in this file, so the fold can be tested on its own.

import { ADVENTURE_FIELDS } from "./origin.mjs";
import { digest, folderSegments } from "./patch.mjs";
import { adventureId } from "./plan.mjs";

/** Where each member type files. Folders are derived from members' paths, never members themselves. */
export const MEMBER_FIELDS = Object.fromEntries(
  Object.entries(ADVENTURE_FIELDS).filter(([type]) => type !== "Folder"));

/**
 * The id of the folder for `type` at `segments` inside a pack's Adventure.
 *
 * Deterministic so a reader's re-import updates folders in place. Foundry
 * folders are typed, so `Places` holding Scenes and `Places` holding journals
 * are two folders.
 */
export function adventureFolderId(moduleId, pack, type, segments) {
  return digest(`${moduleId}.${pack}.${type}:${segments.join("/")}`);
}

/** The folder id an entry's path names, or null for none. */
export function adventureFolderOf(moduleId, pack, entry) {
  const segments = folderSegments(entry.folder);
  return segments.length > 0 ? adventureFolderId(moduleId, pack, entry.type, segments) : null;
}

/** Folder documents for every path the members name, and their parents. */
function folderDocs(moduleId, pack, members) {
  const docs = new Map();
  for (const { type, folder } of members) {
    const segments = folderSegments(folder);
    for (let i = 0; i < segments.length; i++) {
      const id = adventureFolderId(moduleId, pack, type, segments.slice(0, i + 1));
      if (docs.has(id)) continue;
      docs.set(id, {
        _id: id,
        name: segments[i],
        type,
        folder: i > 0 ? adventureFolderId(moduleId, pack, type, segments.slice(0, i)) : null,
      });
    }
  }
  return [...docs.values()];
}

/**
 * Adventure data holding every member, filed by type.
 *
 * @param metadata  The pack's declaration: `label` names the Adventure, and
 *                  `flags.graft` may carry `img`, `caption` and `description`.
 * @param members   `{ type, folder, data }`; `folder` is a path and `data`'s
 *                  own `folder` is already the id `adventureFolderOf` gives.
 */
export function assembleAdventure(moduleId, pack, metadata, members) {
  const content = {};
  for (const { type, data } of members) {
    (content[MEMBER_FIELDS[type]] ??= []).push(data);
  }
  const own = metadata.flags?.graft ?? {};
  return {
    _id: adventureId(moduleId, pack),
    name: metadata.label,
    img: own.img,
    caption: own.caption,
    description: own.description,
    folders: folderDocs(moduleId, pack, members),
    ...content,
  };
}

/**
 * The members of an Adventure, in the shape `assembleAdventure` takes.
 *
 * Folder paths are read back from the Adventure's own `folders`, so a member
 * carried over from a previous build files exactly where it did.
 */
export function membersOf(adventure) {
  const folders = new Map((adventure.folders ?? []).map((f) => [f._id, f]));
  const pathOf = (id) => {
    const names = [];
    for (let f = folders.get(id); f; f = folders.get(f.folder)) names.unshift(f.name);
    return names.length > 0 ? names.join("/") : undefined;
  };
  const out = [];
  for (const [type, field] of Object.entries(MEMBER_FIELDS)) {
    for (const data of adventure[field] ?? []) {
      out.push({ id: data._id, type, folder: pathOf(data.folder), data });
    }
  }
  return out;
}
