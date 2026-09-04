# Hooks and API

Graft itself fetches nothing: a source is a compendium document the reader already has, and building touches nothing outside the world. Content that has to come from elsewhere, a deployed vault or a subscription service, belongs in a module of its own, and graft gives it three moments to act.

**`graftPreBuild`** fires whenever graft needs the transform list: as a build starts, and again just to name transforms in the build prompt. Registering must therefore be cheap and free of side effects. Foundry hooks are synchronous, so the hook only collects; when a build follows, graft awaits each transform once. `moduleId` names the module being built, or `"world"` when a `grafts.json` file is being built into the world.

```js
Hooks.on("graftPreBuild", (moduleId, register) => {
  register({
    id: "my-module",
    label: "My Module",
    async transform(entries) {
      return { entries, skipped: [], warnings: [] };
    },
  });
});
```

`transform` receives every entry the module declares, from every file, and returns an array, or `{ entries, skipped, warnings }`, or nothing. `phase` is `"entries"` (the default) for a transform that produces or rewrites entries, or `"sources"` for one that makes the documents their sources name resolvable. Every entries transform runs before any sources one, registration order deciding within a phase, so a materialiser sees the entries after every marker has been expanded. `skipped` and `warnings` use the builder's `{ id, reason }` shape and appear in the same report, sectioned under the transform's label. Build as much as possible and report the rest: graft reports a failing transform and builds on without it. The usual shape is marker expansion: a module's `grafts.json` holds a line naming what to fetch, and the transform replaces it with the real entries.

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

**`graftBuilt`** fires after every module build, whether it came from the world-load prompt, a compendium header, or the pack control. It carries the built UUIDs, so a module that wants to act on what a build produced (record it, inspect it, download the files its documents name) starts from here. An entry assembled into an Adventure is named `Compendium.<module>.<pack>.Adventure.<advId>.<Type>.<id>`.

```js
Hooks.on("graftBuilt", (moduleId, { built, skipped, warnings, removed }) => {
  // built, skipped and warnings are what the report showed
});
```

## The API

```js
game.modules.get("graft").api    // buildPacks, hydrate, readGrafts, unbuilt, anyBuilt,
                                 // exportDiff, progress
```

`unbuilt` looks entries up by the ids the module declares, so it says nothing about a module whose entries a transform expands: that `grafts.json` names a source to fetch, and there are no ids until a build has run. `anyBuilt` is the question such a module can ask instead, answered from the pack index alone. It counts only what graft made, so a document a reader added by hand is not mistaken for a build.
