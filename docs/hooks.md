# Hooks and API

> [!WARNING]
> **Most module authors do not need to read this page.** It is for modules that extend graft itself: fetching sources from another service, generating entries at build time, or placing files the built-in `http` handler cannot.

Sources refer to compendium document that the reader should already have, so most of a build touches nothing outside of the world that graft is building into. What has to come from elsewhere arrives two ways: a file's `assets` block, fetched by a handler (graft ships `http`), and content a module of its own resolves.

**`graftPreBuild`** lets a module rewrite entries before graft builds them. Your handler calls `register` with a transform, and graft runs each transform once per build. The hook also fires when graft asks the reader whether to build a module, only to list your transform's name in that prompt, and the reader may decline. So the handler should do nothing but call `register`; the real work belongs inside `transform`. `moduleId` names the module being built, or `"world"` for **Import grafts**.

```js
Hooks.on("graftPreBuild", (moduleId, register) => {
  register({
    id: "my-module",
    label: "My Module",
    phase: "entries",
    async transform(entries) {
      return { entries, skipped: [], warnings: [] };
    },
  });
});
```

`transform` receives every entry the module declares, from every file, and returns an array, or `{ entries, skipped, warnings }`, or nothing. `skipped` and `warnings` use the builder's `{ id, reason }` shape and appear in the same report, sectioned under the transform's label. A transform that throws is one report line and the build goes on without it, so build what you can and report the rest. The usual shape is marker expansion: a module's `grafts.json` holds a line naming what to fetch, and the transform replaces it with the real entries.

`phase` decides when it runs, and defaults to `"entries"`. Use `"entries"` for a transform that produces or rewrites entries, and `"sources"` for one that makes the documents their sources name resolvable. Every entries transform runs before any sources one, registration order deciding within a phase, so a materialiser sees the entries after every marker has been expanded.

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

`collect(entries)` is optional, and is `place` in reverse. **Copy graft** and the grafts downloads hand it the entries they are about to write, and it returns the block that would place the files those entries name on somebody else's machine, or nothing when none are its own. Graft writes what it returns under the handler's id. It reads the entries and never changes them. A `collect` that throws fails the copy, which is reported: a copy that silently lacks its files is worse, and pressing **Copy graft** again is free.

```js
async collect(entries) {
  const files = mine(entries);   // the paths in these entries that your service supplies
  return files.length > 0 ? { files } : null;
}
```

**`graftExport`** fires when **Copy graft** has an entry ready, so a module that fetched the source can name it the way its own users would. Graft collects these the same way; `document` is the one being copied.

```js
Hooks.on("graftExport", (register) => {
  register({
    id: "my-module",
    async rewrite(entry, { document }) {
      return entry;
    },
  });
});
```

Return the entry untouched when it is not yours. A rewriter that throws fails the copy, which **Copy graft** reports: the gesture is interactive and pressing it again is free, so failing loudly beats quietly writing a plainer name.

**`graftBuilt`** fires after every build: a module's, whether started from the world-load prompt, a compendium header or the pack control, and an **Import grafts**, whose `moduleId` is `"world"`. It carries the built UUIDs, so a module that records or inspects what a build produced starts from here. An entry assembled into an Adventure is named `Compendium.<module>.<pack>.Adventure.<advId>.<Type>.<id>`, which `fromUuid` rejects; read built documents with `api.resolve`.

```js
Hooks.on("graftBuilt", (moduleId, { built, skipped, warnings, removed }) => {
  // built, skipped and warnings are what the report showed
});
```

## The API

```js
game.modules.get("graft").api    // buildPacks, hydrate, readGrafts, unbuilt, anyBuilt, exportDiff,
                                 // resolve, recordFileSource, placeFile, progress
```

`placeFile(destination, data, type)` writes a file into the data folder, making the folders on the way. It is for an asset handler whose files arrive as data. Foundry's upload rejects a generic content type, so when `type` is missing or `application/octet-stream` the destination's extension decides. `recordFileSource(document, path)` tells graft that a world document was made from the `.json` file at `path`, so **Copy graft** on it writes that path as the source and only the changes as the patch. It is for a module that imports such a document itself; a document graft builds is recorded already.

`resolve(uuid)` returns a document's plain data, or null. It reads every form graft writes, including an entry inside an assembled Adventure.

`readGrafts(moduleId)` returns `{ entries, assets }`: the module's declared entries and the `assets` block a build of them would place. `unbuilt(moduleId)` returns `{ missing, assets }`, the entries not in the packs and the same block.

`unbuilt` looks entries up by the ids the module declares, so it says nothing about a module whose entries a transform expands: that `grafts.json` names a source to fetch, and there are no ids until a build has run. `anyBuilt` is the question such a module can ask instead, answered from the pack index alone. It counts only what graft made, so a document a reader added by hand is not mistaken for a build.
