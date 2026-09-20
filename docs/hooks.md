# Hooks and API

> [!WARNING]
> **Most module authors do not need to read this page.** It is for modules that extend graft itself: placing files the built-in `http` handler cannot, such as content fetched from another service.

Sources refer to compendium documents that the reader should already have, so most of a build touches nothing outside of the world that graft is building into. What has to come from elsewhere arrives through a file's `assets` block, fetched by a handler before anything builds. Graft ships `http`, and a module adds its own with `graftAssets`. An entry names a placed file by its path, and a placed `.json` file can be an entry's `source`.

**`graftAssets`** collects the handlers for the `assets` block. `register` takes `{ id, place, collect }`, where `id` matches the key in the file and `place(config, { onPhase, onFile, redownload })` fetches whatever that block names. `redownload(already, total)` asks the reader once whether to fetch files that are already on disk; resolving true means fetch everything. Registering replaces a handler already under that id, including the built-in `http` one.

```js
Hooks.on("graftAssets", (register) => {
  register({
    id: "my-service",
    async place(config, { onPhase, onFile, redownload }) {
      onPhase("My Service", config.files.length);
      for (const file of config.files) { onFile(file.name); /* fetch and upload */ }
      return { skipped: [], warnings: [] };
    },
  });
});
```

`place` returns `{ skipped, warnings }` in the builder's `{ id, reason }` shape, or nothing. A handler that throws is one report line and the remaining handlers still run. Its only job is to put bytes at a path; it never rewrites entries, so the paths it writes to must be derivable from what the entries already name.

A module that registers a handler and ships no entries of its own requires graft like any other, so it declares `"flags": { "graft": { "entries": [] } }` in its manifest. Without that, graft fetches a `grafts.json` from it that was never meant to exist, and counts its packs when guessing where a **Copy graft** entry belongs.

`collect(entries)` is optional, and is `place` in reverse. **Copy graft** and the grafts downloads hand it the entries they are about to write, and it returns the block that would place the files those entries name on somebody else's machine, or nothing when none are its own. Graft writes what it returns under the handler's id. It reads the entries and never changes them. A `collect` that throws fails the copy, which is reported: a copy that silently lacks its files is worse, and pressing **Copy graft** again is free.

```js
async collect(entries) {
  const files = mine(entries);   // the paths in these entries that your service supplies
  return files.length > 0 ? { files } : null;
}
```

**`graftBuilt`** fires after every build: a module's, whether started from the world-load prompt, a compendium header or the pack control, and an **Import grafts**, whose `moduleId` is `"world"`. It carries the built UUIDs, so a module that records or inspects what a build produced starts from here. An entry assembled into an Adventure is named `Compendium.<module>.<pack>.Adventure.<advId>.<Type>.<id>`, which `fromUuid` rejects; read built documents with `api.resolve`.

```js
Hooks.on("graftBuilt", (moduleId, { built, skipped, warnings, removed }) => {
  // built, skipped and warnings are what the report showed
});
```

## The API

```js
game.modules.get("graft").api    // buildPacks, hydrate, readGrafts, unbuilt, exportDiff,
                                 // resolve, recordFileSource, placeFile
```

`placeFile(destination, data, type)` writes a file into the data folder, making the folders on the way. It is for an asset handler whose files arrive as data. Foundry's upload rejects a generic content type, so when `type` is missing or `application/octet-stream` the destination's extension decides. `recordFileSource(document, path)` tells graft that a world document was made from the `.json` file at `path`, so **Copy graft** on it writes that path as the source and only the changes as the patch. It is for a module that imports such a document itself; a document graft builds is recorded already.

`resolve(uuid)` returns a document's plain data, or null. It reads every form graft writes, including an entry inside an assembled Adventure.

`readGrafts(moduleId)` returns `{ entries, assets }`: the module's declared entries and the `assets` block a build of them would place. `unbuilt(moduleId)` returns `{ missing, assets }`, the entries not in the packs and the same block.
