# Authoring

**1. Make the module.** A directory in `Data/modules/` with a `module.json` declaring your packs, `requires` for graft and your system, and either `requires` or `recommends` for each source you graft onto. `examples/graft-example/` is a working one.

**2. Restart the world.** Foundry reads manifests when a world launches. A browser reload is not enough; the symptom is a build error saying your module declares no such pack.

**3. Build in your world, the ordinary way.** Import a monster and edit it, drag items onto it, create your own documents. Nothing in this step is graft-specific.

**4. Copy the grafts.** Right-click a document in the sidebar for **Copy graft**, or right-click a folder for **Copy grafts** to copy everything in it and its subfolders. The sheet header has the same control for an open document. Paste the result into the `entries` list in `grafts.json`, beside your `module.json`.

**5. Build**, from the prompt on world load or from **Build grafts** in your pack's window header, and read the report.

**6. Test what a reader without your sources gets.** Disable a module you graft onto and build again. The report should list those entries as skipped and everything else should build.

> [!WARNING]
> **Do not distribute the `packs/` directory.** Building writes the resolved documents into your packs, including descriptions, stat blocks and maps. Publishing the module directory after a test build would distribute everything this format exists to avoid.
>
> A graft module is `module.json`, `grafts.json`, and whatever art and code are yours. Add `packs/` to `.gitignore`.

## Copying runs one way

**Copy graft** works on documents in the world, not in compendiums. You build in the world and graft writes to compendiums.

What you get depends on where the document is:

| Document | Result |
|---|---|
| In a pack anyone can install | A reference with an empty patch: include this, unchanged |
| In a world pack, or the world, with a recorded source | A diff against that source |
| Yours, with no recorded source | The whole document |

Graft checks the installable-pack case first. That is what makes chaining work: **Copy graft** on a document that graft built produces a reference to it, not a replay of the patch that produced it.

## How the source is recovered

Foundry stamps `compendiumSource` on anything imported from a pack. That is what lets **Copy graft** recover a diff without you typing a UUID. But it only records where a document was last imported from, by whoever imported it. Publishers often assemble content in a private work module, and that id survives into the published content, naming something nobody else can install.

Graft records its own answer where it can. `preImportAdventure` stamps `flags.graft.origin` with the adventure's UUID, and that stamp is preferred when present. Ordinary imports need no help: `fromCompendium` writes an accurate source itself, regardless of `keepId`.

That stamp is also what makes adventure content referenceable. An adventure's contents are embedded data, not documents, so they have no UUID of their own. Graft resolves one form, written like the embedded UUIDs Foundry already uses:

```
Compendium.<module>.<pack>.Adventure.<advId>.JournalEntry.<docId>
```

Graft handles an unresolvable source one of two ways. If the source module is **installed but disabled**, the export refuses until you enable it. If it is **not installed at all**, graft treats the document as having no recorded source and copies it whole. Its full content then sits in your `grafts.json`, where you can see it and decide whether to publish it.

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

A pack declared as `Adventure` collects every entry that names it into one Adventure. See [Packaging](format.md#packaging).

A grafts file is an object, not a bare list:

```json
{ "format": 2, "entries": [ … ] }
```

`format` is the entry format version. Absent means 1. Format 1 files still read; only their `type: "Adventure"` entries are refused. A file with a newer format than this graft understands is skipped, with a log line saying graft needs updating.

Everything else in the object is left alone, so a module or a graft extension can keep its own data beside the entries.
