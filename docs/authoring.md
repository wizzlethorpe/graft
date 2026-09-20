# Authoring

**1. Make the module.** A directory in `Data/modules/` with a `module.json` declaring your packs, `requires` for graft and your system, and either `requires` or `recommends` for each source you graft onto. `examples/graft-example/` is a working one.

**2. Restart the world.** Foundry reads manifests when a world launches, so a browser reload may not be enough.

**3. Build in your world, the ordinary way.** Import a monster and edit it, drag items onto it, create your own documents. Nothing in this step is graft-specific.

**4. Copy the grafts.** Right-click a document in the sidebar for **Copy graft**, or right-click a folder for **Copy grafts** to copy everything in it and its subfolders. The sheet header has the same control for an open document. Either copies a whole `grafts.json`, with an `assets` block when an installed asset handler says the entries need one: keep it as the file beside your `module.json`, or lift only its `entries` into an existing `grafts.json` that you already have.

**5. Build**, from the prompt on world load or from **Build grafts** in your pack's window header, and read the report. **Copy report** puts it on the clipboard as text for a bug report.

**6. Test what a reader without your sources gets.** Disable a module you graft onto and build again. The report should list those entries as skipped and everything else should build.

> [!WARNING]
> **Do not distribute the `packs/` directory.** Building writes the resolved documents into your packs, including descriptions, stat blocks and maps. Publishing the module directory after a test build would distribute everything this format exists to avoid.
>
> A graft module is `module.json`, `grafts.json`, and whatever art and code are yours. Add `packs/` to `.gitignore`.

## How the source is recovered

Foundry stamps `compendiumSource` on anything imported from a pack. That is what lets **Copy graft** recover a diff without you typing a UUID. But it only records where a document was last imported from, by whoever imported it. Publishers often assemble content in a private work module, and that id survives into the published content, naming something nobody else can install.

Graft records its own answer where it can. `preImportAdventure` stamps `flags.graft.origin` with the adventure's UUID, and that stamp is preferred when present. A document built from a `.json` file gets `flags.graft.source`, since a path is not a UUID and `compendiumSource` cannot hold one. **Copy graft** on it names the file again and carries only what differs from it. When a document has both, `compendiumSource` is used: a drag out of a pack writes it, so it is the newer fact. A module that places such a file itself marks the document with `game.modules.get("graft").api.recordFileSource(document, path)`. Ordinary imports need no help: `fromCompendium` writes an accurate source itself, regardless of `keepId`.

`flags.graft.origin` is also what makes adventure content referenceable. An adventure's contents are embedded data, not documents, so they have no UUID of their own. Graft resolves one form, written like the embedded UUIDs Foundry already uses:

```
Compendium.<module>.<pack>.Adventure.<advId>.JournalEntry.<docId>
```

Graft handles an unresolvable source one of three ways. If the source module is **installed but disabled**, the export refuses until you enable it. If the source is a **file that is not on disk**, the export refuses until the graft that places it has been built. If the module is **not installed at all**, graft treats the document as having no recorded source and copies it whole. Its full content then sits in your `grafts.json`, where you can see it and decide whether to publish it.

## Dependencies

Declare them through Foundry's own `relationships`, so Foundry reports a missing one itself.

- **`requires`** for what the module cannot work without: graft, and the system its packs declare. Foundry stops the reader from disabling these. Require a source you graft onto as well if your module is pointless without it.
- **`recommends`** for the rest of what you graft onto. A missing source only skips its own entries, so recommending leaves everything else building and lets you test against a missing dependency. Requiring turns a skipped entry into a module that will not load.

## Manifest options

Optional, in your `module.json`:

```json
"flags": {
  "graft": {
    "entries": ["grafts/actors.json", "grafts/scenes.json"],
    "packs": { "Actor": "my-main-actors" }
  }
}
```

`entries` defaults to `grafts.json`. `packs` only affects **Copy graft**. Without it, Copy graft picks the one pack of the entry's type, or the one Adventure pack if there is no typed pack, and leaves `pack` blank when there are two candidates.

A pack declared as `Adventure` collects every entry that names it into one Adventure. See [Packs](format.md#packs).
