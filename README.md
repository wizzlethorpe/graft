# Graft

[![tests](https://github.com/wizzlethorpe/graft/actions/workflows/test.yml/badge.svg)](https://github.com/wizzlethorpe/graft/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/wizzlethorpe/graft)](LICENSE)
[![release](https://img.shields.io/github/v/release/wizzlethorpe/graft?display_name=tag&sort=semver)](https://github.com/wizzlethorpe/graft/releases/latest)

Graft packages your changes to somebody else's compendium content as a **diff** and rebuilds the result on the reader's machine. A graft module ships pointers and patches, not the content it builds on.

**Install:** paste this into Foundry's *Install Module* dialog.

```
https://github.com/wizzlethorpe/graft/releases/latest/download/module.json
```

**Status:** working prototype, exercised in a live world across Actors, Items, Scenes, Journals, Playlists and Adventures. Not on Foundry's package registry; the format may change.

> [!IMPORTANT]
> **Your content is your responsibility.** A patch can still reproduce protected material: a description rewritten in full, a stat block restated, a map's whole wall layout. Graft cannot tell the difference and does not check entitlement; it resolves whatever UUIDs an entry names against whatever the reader has installed.
>
> Check what your grafts contain before publishing, and honour the licences of what you build on.

The name comes from horticulture: a graft joins a shoot (the scion) to another plant's roots (the rootstock).

---

## The format

Four fields: an `id` and `type` of your own, a `source` to graft onto, and a `patch`.

```yaml
id: banditCaptain001               # a Foundry document id: [a-zA-Z0-9]{16}
type: Actor
pack: my-actors                    # which of your module's packs it lands in
source: Compendium.some-bestiary.actors.Actor.mmBandit000000
patch:
  name: The Enforcer
  system:
    attributes: { hp: { value: 45 } }
    details: { cr: null }          # null deletes, per RFC 7386
  items:
    - _id: itemCrossbow001         # keyed: patches that item, leaves the rest
      system: { damage: "2d8" }
```

Building resolves the source, applies the patch, and creates the result under your id in your pack. If a source cannot be resolved, that entry is skipped and listed in the report; every other entry still builds.

**`folder`** is optional and is a path of names, not an id:

```yaml
folder: Magic Items/Bags
```

Folder ids do not survive to another machine, but the folder structure does. Folders are created during the build and matched by name and parent, so renaming one by hand survives the next build.

**`source`** is optional. Without one, the patch is the whole document, so a graft module can also ship original content. A `source` that is present but empty is an error.

A `source` that is a bare document id names another entry in the same module. Nothing else a source may hold looks like one, since no document type name is sixteen characters and a bare id is not a UUID, so the short form is unambiguous. It is also portable: it survives the module being renamed, and an import into somebody else's world can resolve it against whatever packs it creates. What it cannot say is which pack it meant, so an id two entries share is reported rather than guessed at.

```yaml
source: banditCaptain001            # the entry with this id, wherever it lands
```

`source` may also be a list of fallbacks, tried in order:

```yaml
source:
  - Compendium.premium-bestiary.actors.Actor.mmBandit000000   # if they own it
  - Compendium.dnd5e.actors.Actor.srdBandit000000             # otherwise this
```

The first source that resolves is used, so an author can prefer better content without requiring it. The entry fails only if none of them resolve. A list source records no `sourceHash`, because a hash is taken against the specific document the author diffed and a list does not say which one that was.

## Authoring

**1. Make the module.** A directory in `Data/modules/` with a `module.json` declaring your packs, `requires` for graft and your system, and `recommends` for each source you graft onto. `examples/graft-example/` is a working one.

**2. Restart the Foundry server.** Manifests are read at startup. A browser reload is not enough; the symptom is a build error saying your module declares no such pack.

**3. Build in your world, the ordinary way.** Import a monster and edit it, drag items onto it, create your own documents. Nothing in this step is graft-specific.

**4. Copy the grafts.** Right-click a document in the sidebar for **Copy graft**, or right-click a folder for **Copy grafts** to copy everything in it and its subfolders. The sheet header has the same control for an open document. Paste the result into `grafts.json` beside your `module.json`.

**5. Build**, from the prompt on world load or from **Build grafts** in your pack's window header, and read the report.

**6. Test what a reader without your sources gets.** Disable a module you graft onto and build again. The report should list those entries as skipped and everything else should build.

> [!WARNING]
> **Do not distribute the `packs/` directory.** Building writes the resolved documents into your packs, including descriptions, stat blocks and maps. Publishing the module directory after a test build ships everything this format exists to avoid.
>
> A graft module is `module.json`, `grafts.json`, and whatever art and code are yours. Add `packs/` to `.gitignore`.

### Copying runs one way

**Copy graft** works on documents in the world, not in compendiums. You build in the world; graft writes to compendiums.

What you get depends on where the document is:

| Document | Result |
|---|---|
| In a pack anyone can install | A reference with an empty patch: include this, unchanged |
| In a world pack, or the world, with a recorded source | A diff against that source |
| Yours, with no recorded source | The whole document |

Graft checks the installable-pack case first. That is what makes chaining work: **Copy graft** on a document that graft built produces a reference to it, not a replay of the patch that produced it.

## Using it

Every operation is available from the UI.

- **Installing.** When a graft module has unbuilt entries, graft offers to build on the next world load. It asks once per module and remembers the answer; declining can be reversed.
- **Rebuilding.** **Build grafts** sits in the header of that module's compendium windows.
- **The report** lists what was not built and why, then anything built with warnings, then a collapsed list of successes as clickable links. Results land in the **Compendium** tab.
- **Exporting.** Beside **Copy graft** on a document or folder, **Export graft** writes the same entries to a file. Always a list, even for one document, because that is the shape a `grafts.json` takes.
- **Building a file.** **Build from file** on the Compendium tab takes a `grafts.json` somebody sent you and builds it into world compendiums, one per document type, filed together under a name you give. Providers run as they would for a module, so a file naming content from one builds when you have it installed. Nothing is tracked afterwards: there is no manifest to compare against, so this is an import rather than a subscription.

Whether an entry is built is read from the pack index, not from a stored flag, so both a hand-deleted document and a newly shipped entry are detected as unbuilt. Packs are unlocked for the write and restored exactly as found, including their folder assignment.

An entry whose document would come out exactly as it already is skips its write. Compared against what is in the pack rather than against a remembered digest, so a Foundry upgrade that migrates the same input differently, and an edit made in the pack by hand, both still rebuild. Only the timestamps Foundry rewrites on every save are ignored.

`unbuilt` looks entries up by the ids the module declares, so it says nothing about a module whose entries come from a provider: that `grafts.json` names a source to fetch, and there are no ids until a build has run. `anyBuilt` is the question such a module can ask instead, answered from the pack index alone. It counts only what graft made, so a document a reader added by hand is not mistaken for a build.

```js
game.modules.get("graft").api    // buildPacks, hydrate, readGrafts, unbuilt, anyBuilt,
                                 // exportDiff, registerProvider, registeredProviders, progress
```

Tests: `node --test 'test/*.test.mjs'`

## Chaining

`id` is a Foundry document id, not a slug, so your output has a normal UUID:

```
Compendium.<module>.<pack>.<Type>.<id>
```

Grafting onto a graft is not a special case. Another author names your output the way they would name any document, and your module becomes an ordinary dependency of theirs.

Order does matter. `planOrder` sorts entries so that anything grafted onto a sibling in the same module is built after it, and refuses two entries that graft onto each other rather than half-building them. Sources outside the module need no sequencing; Foundry already reports a missing dependency.

The open risk is drift: if the base you built on is rebuilt against a new source, your patch may still apply and produce something different.

## Dependencies

Declare them through Foundry's own `relationships`, so Foundry reports a missing one itself.

- **`requires`** for what the module cannot work without: graft, and the system its packs declare. Foundry stops the reader from disabling these.
- **`recommends`** for content you graft onto. A missing source only skips its own entries, so hard-requiring one turns a skipped entry into a module that will not load, and makes the module impossible to test against a missing dependency.

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

`entries` defaults to `grafts.json`. A declared file that cannot be read is a warning; a missing default file is not.

A grafts file may be a bare array, or an object declaring the format it was written for:

```json
{ "format": 1, "entries": [ … ] }
```

Absent means 1. A file declaring a newer format is refused rather than partially read, since fields the newer format relies on would otherwise be ignored silently. `packs` only affects **Copy graft**, which otherwise picks the pack when your module has exactly one of that type and gives up when it has two.

## Providers

A provider rewrites entries before anything is built. Moulinette is the first.

```js
Hooks.on("graftRegisterProviders", ({ registerProvider }) => {
  registerProvider({
    id: "my-provider",
    label: "My Provider",
    async hydrate(entries) {
      return { entries, skipped: [], warnings: [], enqueue: [] };
    },
  });
});
```

`hydrate` receives every entry the module declares, from every file, and returns an array, or `{ entries, skipped, warnings, enqueue }`, or nothing. `skipped` and `warnings` use the builder's `{ id, reason }` shape and appear in the same report, sectioned by provider. Build as much as possible and report the rest.

**Providers run from a queue, not to a fixed point.** "Is there work left" can be answered; "has anything changed" cannot. A provider that emits syntax another provider handles lists that provider in `enqueue`, since only the emitting provider knows which one that is. The queue deduplicates against pending work, not completed work, so a provider re-runs for input that did not exist when it first ran. Mutual recursion is capped, and the report names whichever provider would not settle.

`hydrate` should be idempotent, and may not enqueue itself.

## Hooks

`graftBuilt` fires after every build, whether it came from the world-load prompt, a compendium header, or the pack control. A module that tracks what it last built cannot see those controls itself, so this is how it finds out.

```js
Hooks.on("graftBuilt", (moduleId, { built, skipped, warnings, removed }) => {
  // built, skipped and warnings are what the report showed
});
```

**The recommended shape:** fetch what an entry names, apply its patch to that JSON, and return a sourceless entry carrying the result. This needs no pack of your own and no ids that could collide. Record provenance in `flags.graft`. It also keeps the provider a plain array-to-array transform, testable without Foundry. Since a provider is often the only component that sees the original document, most warnings have to come from it.

## Moulinette

Ships with graft, registered only when the Moulinette module is enabled.

```
@moulinette/<pack_ref>/<filepath>
@moulinette/10698/scenes/abandoned-mine-entrance.webp
```

`pack_ref` is the number in a marketplace URL. The slugs beside it are display names and change when a pack is renamed; the number does not.

As an entry's `source` it names a **document**, which is fetched and patched. Inside a patch it names a **file**, which is downloaded and rewritten to a local path. A reference that will not resolve drops its immediate container and nothing more: a `background` with no `src` is dropped entirely, but one missing sound does not discard the scene. Everything dropped is listed in the report.

Nothing is redistributed. The reader's own subscriptions decide what they get.

**Copying does not run backwards.** Moulinette fires no hooks and stamps no flags of its own, so a document it imported carries only the publisher's provenance, and `_stats.compendiumSource` names the publisher's private work module rather than anything a reader can install. **Copy graft** on one therefore takes the no-recorded-source path and carries the whole document, walls and lights included, with its asset paths left as the local `moulinette-v2/...` ones that resolve on your machine only. Check what it produced before shipping it.

## Format details

Patches use [RFC 7386](https://www.rfc-editor.org/rfc/rfc7386) (JSON Merge Patch), because a patch that mirrors the shape of the document is readable, and `null` already means "delete this key". [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) is more expressive, and its `test` op would give drift detection for free, but it addresses array members by position.

**The one departure: arrays whose members all carry `_id` merge by that key. Everything else replaces.** Foundry's arrays are collections of embedded documents with no meaningful order, so changing one item's damage should not require restating forty, and should not break when the source reorders them.

### Embedded content is a graft too

An embedded document can be somebody else's content as well, so an entry in a keyed array takes one of two shapes:

```yaml
items:
  - _id: itemCrossbow001            # patch an entry already in the source
    system: { damage: "2d8" }
  - _id: IP7kWWdq5km8SZad           # a graft inside a graft
    source: Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt
    patch: { system: { equipped: true } }
```

The second shape is produced automatically: Foundry records where the item came from, so **Copy graft** references it rather than copying it. An embedded source that will not resolve fails the whole entry, because a stat block silently missing the item it was built around is worse than a skipped entry that names the dependency.

An embedded source naming a sibling is an ordering edge like a top-level one, so an item can be declared as its own entry and put on an actor in the same file whichever order the two appear in. A loop through an inserted item is reported the same way as any other.

### What is stripped

- **`_stats`**, whose timestamps differ between identical documents and would report every embedded item as changed.
- **`folder`**, at the root only. It is kept at depth, which matters for Adventures: they carry their own `folders` array and their documents point into it.
- **`active`, `navOrder` and `thumb`**, at the root, which say where a Scene sat in the world it was copied from rather than what the scene is: which scene that world is looking at, where it sits in the navigation bar, and a path into that world's own generated thumbnails. `sort` is kept, since a graft may reasonably want to say where its output sits in a pack.
- **`ownership`** is thinned rather than dropped. Per-user entries are world-local and are removed; `default` stays, since it is how you say "players can see this".

Nothing else is stripped, and in particular **no other module's flags**. Those are that module's data, and graft leaves them alone.

### Drift warnings

A patch is written against a source at a moment in time. Graft checks for three kinds of drift. All three **warn** rather than refuse, because a changed source usually still patches correctly, and refusing would strand a reader over an upstream typo fix.

- **A different system.** `_stats.systemId` records which system a document was authored for. A pf2e actor grafted into a dnd5e world is incompatible rather than merely drifted, and without this check it would build without any warning.
- **An older generation.** Foundry or system majors only. Systems ship minors constantly and most break nothing, so warning on each would train readers to ignore the section.
- **The source itself changed.** An entry records `sourceHash`, a digest of the source **projected onto the patch's shape**, so only the fields the patch touches:

```yaml
source: Compendium.some-bestiary.actors.Actor.mmBandit000000
sourceHash: 7f3a91c2e40b8d15
patch:
  system: { attributes: { hp: { value: 45 } } }
```

Hashing only the patched fields keeps the warning useful: an upstream fix to a description you never touched does not warn. Reordering a keyed array is not drift, and neither is key order in the source.

A missing `sourceHash` means the hash was never recorded, so no drift check runs.

### Old documents are migrated

Everything is created through `Document.fromImport`, Foundry's own migration path. Creating directly would store old data unchanged against the current schema, and the failure is quiet: a Foundry 13 scene arrives with v13 tile coordinates read under v14 anchor semantics, so every tile sits half its own size out of place.

A source older than the running generation is still reported, since migration handles fields that moved but not fields that were removed.

An Adventure cannot take that path whole: the server migrates with `db.Adventure`, and Adventures have no world collection, so any version difference at all crashes it. The documents *inside* an Adventure all have one, so they migrate one at a time through their own classes and the Adventure is constructed around the results; a document that cannot migrate is kept as authored and named individually.

Import-time migration is also less complete than the migration Foundry runs when a world is upgraded. A Foundry 13 tile's `occlusion.mode` is dropped rather than converted to the `occlusion.modes` that replaced it, by `fromImport` and `importFromJSON` alike, so a roof set to fade stops fading. Graft does not migrate fields by hand; the set of moved fields is open-ended.

### How the source is recovered

Foundry stamps `compendiumSource` on anything imported from a pack. That is what lets **Copy graft** recover a diff without you typing a UUID. But it only records where a document was last imported from, by whoever imported it. Publishers often assemble content in a private work module, and that id survives into the published content, naming something nobody else can install.

Graft records its own answer where it can. `preImportAdventure` stamps `flags.graft.origin` with the adventure's UUID, and that stamp is preferred when present. Ordinary imports need no help: `fromCompendium` writes an accurate source itself, regardless of `keepId`.

That stamp is also what makes adventure content referenceable. An adventure's contents are embedded data, not documents, so they have no UUID of their own. Graft resolves one form, written like the embedded UUIDs Foundry already uses:

```
Compendium.<module>.<pack>.Adventure.<advId>.JournalEntry.<docId>
```

An unresolvable source is handled in one of two ways. If the source module is **installed but disabled**, the export refuses until you enable it. If it is **not installed at all**, graft treats the document as having no recorded source and copies it whole. Its full content then sits in your `grafts.json`, where you can see it and decide whether to ship it.

### Limits

- **Removing an entry from a keyed array** is not expressible: an omitted entry means "leave it alone". Expressing removal would need RFC 6902 `remove`, which addresses by position.
- **`null` resets, it does not remove.** The key does leave the patched data, but Foundry then loads it against a schema, and an absent field takes its declared initial value. True deletion only works where the schema does not describe the key, in practice `flags`.
- **Sets serialise as ordered arrays.** `SetField` has no meaningful order but compares as a list, so a reordering reads as a change. Not handled, because guessing which arrays are Sets could silently drop a genuine reorder of a list that is ordered.
- **Pruning removes only what graft built.** Deleting an entry from `grafts.json` removes the flagged document it built on the next build; documents an author placed in the pack by hand are never touched. An entry a provider skipped this run — a lapsed subscription, say — still counts as declared and is left alone.

## Layout

```
scripts/patch.mjs      the format: applyPatch, diff, stripVolatile. Pure.
scripts/plan.mjs       ids, UUIDs, and build order for chains.
scripts/providers.mjs  the provider queue. Pure.
scripts/yaml.mjs       clipboard output. Pure.
scripts/hydrate.mjs    everything that needs Foundry: resolve, migrate, unlock, write.
scripts/modules.mjs    reads what a module declares.
scripts/moulinette.mjs the Moulinette provider.
scripts/origin.mjs     recovers a document's true source.
scripts/progress.mjs   the build's progress bar.
scripts/ui.mjs         controls, menus, dialogs.
scripts/main.mjs       hooks only.
```

Graft ships code and no content, and is system-agnostic: the only Foundry fields it knows are `_stats`, `ownership` and `folder`. Foundry requires an Actor or Item pack to declare its system, so a module shipping packs cannot be system-agnostic. Your module declares the packs, the system and the dependencies; graft builds them.
