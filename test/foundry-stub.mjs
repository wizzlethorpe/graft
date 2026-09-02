// Just enough Foundry to exercise the parts that need it.
//
// `exportDiff` is the most intricate code in the project and the only place
// several bugs have ever lived: four branches, a precedence that was backwards
// once, and a whole-versus-partial distinction that was wrong in both
// directions. All of that is our logic, not Foundry's, and it needs very
// little of the real thing to run.
//
// Installed on `globalThis` because that is how the module reaches Foundry.

/**
 * @param {object} opts
 * @param {object} opts.uuids     uuid -> plain document data resolved by `fromUuid`
 * @param {object} opts.packs     collection -> `{ packageType }`
 * @param {object} opts.modules   module id -> `{ title, active }`
 * @param {object} opts.world     `{ generation, systemId, systemVersion }`
 */
export function installFoundry({ uuids = {}, packs = {}, modules = {}, world = {} } = {}) {
  const w = { generation: 14, systemId: "dnd5e", systemVersion: "5.3.3", ...world };

  globalThis.game = {
    release: { generation: w.generation },
    system: { id: w.systemId, version: w.systemVersion },
    modules: { get: (id) => modules[id] ?? null },
    packs: { get: (c) => (packs[c] ? { metadata: { packageType: packs[c].packageType } } : null) },
  };
  // The export path collects rewriters on every call. A test wanting one
  // replaces this after installing.
  globalThis.Hooks = { callAll: () => {} };
  globalThis.fromUuid = async (uuid) => {
    const data = uuids[uuid];
    return data ? asDocument(data) : null;
  };
  globalThis.foundry = {
    utils: {
      setProperty(obj, path, value) {
        const keys = path.split(".");
        let node = obj;
        for (const k of keys.slice(0, -1)) node = node[k] ??= {};
        node[keys.at(-1)] = value;
      },
    },
  };
}

export function uninstallFoundry() {
  delete globalThis.game;
  delete globalThis.Hooks;
  delete globalThis.fromUuid;
  delete globalThis.foundry;
}

/** A document as `exportDiff` uses one: identity, a pack, and `toObject`. */
export function asDocument(data, { pack = null, uuid = null } = {}) {
  return {
    id: data._id,
    name: data.name,
    documentName: data.type ?? data.documentName ?? "Actor",
    pack,
    uuid: uuid ?? (pack ? `Compendium.${pack}.Actor.${data._id}` : `Actor.${data._id}`),
    _stats: data._stats,
    flags: data.flags,
    folder: null,
    toObject: () => structuredClone(data),
  };
}
