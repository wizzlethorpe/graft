# Graft

Package your changes to somebody else's compendium content as a **diff**, and hydrate it on the reader's machine. The artifact carries pointers and patches, never the content, so you can distribute work built on material you do not have the right to redistribute.

A graft joins your scion to somebody else's rootstock. The result grows as one plant, but you only ever supplied the shoot.

## Your content is your responsibility

Graft is built so that an artifact carries pointers and patches rather than somebody else's content, and the tests hold it to that. **That is a design property, not a legal opinion, and it does not make anything you distribute lawful by itself.**

What you write in a patch is your own expression. Whether you may distribute something derived from another creator's work depends on their licence, on what your patch actually contains, and on where you are. A patch small enough to be a pointer is still capable of reproducing protected material: a description rewritten in full, a stat block restated, a map's whole wall layout. Graft will happily carry any of it, because it cannot tell the difference.

Nor does it check entitlement. It resolves whatever UUIDs an entry names against whatever the reader happens to have installed, and asks nothing about whether either of you is licensed to hold it.

So: check what your grafts contain before you publish them, honour the licences of what you build on, and do not treat "graft only ships a diff" as a defence. It is a good default, not a shield.

## Status

Working prototype, exercised in a live world. Eight entries across Actor, Item and Scene documents built from five source modules, including a graft onto another graft and a DC Maps scene whose 570 walls stay in DC Maps while one becomes a secret door. 37 tests cover the format, the ordering and the clipboard output.

Not published to Foundry's package registry, and not stable: the format may change.

## The format

Four fields. A patch, an id and type of your own, and a source it grafts onto.

```yaml
id: banditCaptain001               # a Foundry document id: [a-zA-Z0-9]{16}
type: Actor
source: Compendium.dnd-monster-manual.actors.Actor.mmBandit000000
patch:
  name: Marlo's Enforcer
  system:
    attributes: { hp: { value: 45 } }
    details: { cr: null }          # null deletes, per RFC 7386
  items:
    - _id: itemCrossbow001         # keyed: patches that item, leaves the rest
      system: { damage: "2d8" }
```

Hydration is `fromUuid(source)`, `toObject()`, apply the patch, create under your id in the target pack. A source that does not resolve means the reader lacks the module, and the entry is skipped with a warning rather than half-built.

**`folder` is optional**, and is a path of names rather than an id:

```yaml
folder: Magic Items/Bags
```

An id names a folder in one particular world or pack and resolves to nothing anywhere else, which is why `folder` is stripped from the patch itself. The shape you organised your work into is worth keeping though, so it travels as names and the folders are created in your pack on the way in. Matched by name and parent rather than a derived id, so renaming or recolouring one by hand survives the next build.

**`source` is optional.** Without one the patch *is* the document, carried whole. A graft module is an adventure rather than only a pile of derivatives, so the things you invent belong in the same pack as the things you borrow. Absent means "this is mine"; present but empty is an error, because somebody meant to name one.

**Copy graft** lives in the world, and only there. A graft is an edit *of* something from a compendium, and you make that edit in the world: the actor with the items on it, the scene you have walled. Right-click any document in a directory, or a folder for **Copy grafts** to take everything in it and its subfolders. The control on a document sheet is the same thing for something already open.

Copying runs one way on purpose. The world is where you build; a compendium is where graft puts what it builds. Assembling a pack by hand and exporting from it would be a second way to do the same job, and a worse one, since it separates the work from the documents you were editing.

It works out which shape you have, and the order it asks in matters.

A document in a pack somebody else can install already *is* a source, whatever it remembers about its own past, so it becomes a pure reference with an empty patch: include this, unchanged. That is asked first, and it is what makes chaining work. Graft's own output lives in its module's packs, so pressing **Copy graft** on a built document answers "reference this" rather than replaying the patch that produced it. That patch lives in `grafts.json`, which is where it belongs, and re-deriving it here would mean nobody could ever graft onto a graft.

A **world** pack is the opposite, being a workbench rather than something anybody can install, so documents there are still diffed against where they came from. That is what makes assembling a pack by hand worth doing: drag in somebody's monster, edit it, and bulk-export a real diff. Foundry draws the same line for whether a pack is locked by default.

Otherwise, a document imported from a compendium is diffed against where it came from, and one you wrote yourself travels whole.

## Chaining

`id` is a **Foundry document id**, not a slug, because what you produce has to be addressable by anything else:

```
Compendium.<module>.<pack>.<Type>.<id>
```

So grafting onto a graft is not a special case. Somebody names your output the way they would name a Monster Manual entry, and your module is an ordinary dependency of theirs. Nothing in the format changes.

What does change is **order**: a patch applied before its parent exists is a patch applied to nothing. `planOrder` sorts entries so anything grafted onto a sibling comes after it, and refuses two entries that graft onto each other rather than half-building them, because a document in a pack that nobody can explain is worse than an absent one. Sources pointing outside the module need no sequencing: `fromUuid` either resolves them or it does not, and Foundry reports a missing dependency better than we could from inside.

The open risk in a chain is drift. If the base you built on rebuilds against a new source, the patch below you may still apply and mean something else. This is where RFC 6902 `test` operations would earn their keep, asserting the parent looks how you expected and failing loudly when it does not.

## Why merge patch

[RFC 7386](https://www.rfc-editor.org/rfc/rfc7386) (JSON Merge Patch), because a patch that mirrors the shape of the thing it patches is one a person can write and read in YAML, and `null` already means "delete this key" without inventing a sentinel.

[RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) (JSON Patch) is the more expressive standard, and its `test` operation is drift detection for free. It is the right escape hatch if this needs one, and the reason it is not the default is that it addresses array members positionally.

### The one departure

**Arrays whose members all carry `_id` merge by that key. Everything else replaces.**

Merge patch replaces an array wholesale, and JSON Patch indexes into it. Neither suits Foundry, where an array is usually a collection of embedded documents that each have an id and whose order is not meaningful. Changing one item's damage should not mean restating forty items, and should not break when the source reorders them.

This is the only place the format departs from a published standard, and it exists because Foundry's data model gave those arrays keys.

### Embedded content is a graft too

An embedded document can be somebody else's content as well. Adding a magic item to a statblock would otherwise put that item's whole body in the patch, description and licence and all, which is precisely what this format exists to avoid.

So an entry in a keyed array takes one of two shapes:

```yaml
items:
  - _id: itemCrossbow001            # patch an entry already in the source
    system: { damage: "2d8" }
  - _id: IP7kWWdq5km8SZad           # a graft inside a graft
    source: Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt
    patch: { system: { equipped: true } }
```

The second form addresses its source exactly as the outer entry does, and is recovered automatically: Foundry recorded where the item was imported from, so **Copy graft** references it rather than copying it. Content with no recorded source is shipped whole, because content the author wrote is theirs.

An embedded source that does not resolve refuses the whole entry rather than building it without. A statblock quietly missing the magic item it was built around is worse than one that will not build and names the dependency.

### Declaring where the entries are

A module's entries are read from `grafts.json` beside its `module.json`. A larger one can split them, and say which pack an export should default to, in the manifest:

```json
"flags": {
  "graft": {
    "entries": ["grafts/actors.json", "grafts/scenes.json"],
    "packs": { "Actor": "my-main-actors" }
  }
}
```

Both are optional. `entries` defaults to `grafts.json`, and a file that is named but cannot be read is a warning, where a missing default one simply means the module ships no grafts.

`packs` is only about **Copy graft**. An entry has always named its own pack, so a module with two Actor packs builds correctly either way; what it fixes is the guess made at export time, which fills the field in for you when exactly one pack of that type exists and gives up when there are two, leaving every entry to be edited by hand.

### What is stripped, and what is not

Before diffing, at every depth:

- **`_stats` is removed.** Its timestamps and last-editor id differ between two identical documents, so leaving it in reports every embedded item as changed when none are.
- **`folder` is removed at the root**, because an id names a folder in one world or pack. The path of names is carried on the entry instead, and rebuilt on the way in. It is *kept* at depth, which matters for Adventures: an Adventure carries its own `folders` array and its embedded documents point into it, and that array travels with them, so those ids stay meaningful on the other side.
  Checking this by hand is misleading: `folder` on an embedded document is a `ForeignDocumentField`, so on an instantiated Adventure it resolves against `game.folders`, finds nothing, and reads as `null` even when the data is perfectly intact. Compare `adventure.toObject()` against the source instead.

- **`ownership` is thinned, not removed.** The per-user entries are ids from one world and mean nothing elsewhere. `default` stays: it is the only way to say "players can see this" about a handout or a player-facing item, and that is an authorial decision rather than an accident of where the document was edited.

Nothing else, and in particular **no other module's flags**. A patch will carry whatever Scene Packer or anything else stamped on a document. That is noise, but a third-party flag is inert on apply if the reader lacks the module and possibly wanted if they have it. Tidying it would be an editorial judgement about somebody else's data, and would commit this to maintaining a list of other people's module names.

### `compendiumSource` is not provenance

Foundry stamps `_stats.compendiumSource` on anything imported from a pack, which is what lets an author edit a monster in the ordinary sheet and have the diff recovered for them. It records where a document was last imported from *by whoever imported it*, though, and that is not the same as where you can get it.

Publishers routinely assemble a module in a private work module, and Foundry stamps its id on every document. Packaging into an adventure carries the stamp along, and adventure import carries it into your world. Flesh Mountain's journal points at `aa-mad-workmodule`, which was never published and which nobody outside that studio can resolve.

Graft records its own answer where it can. `preImportAdventure` hands over each document's data before it is created, so an adventure import stamps `flags.graft.origin` with the adventure's UUID, which is real and resolves for anybody who owns the module. That is preferred over `compendiumSource` when present. It is not done for ordinary imports, where a second copy would buy nothing but a monkeypatch of a core method. `WorldCollection#fromCompendium` writes `_stats.compendiumSource` itself, computed from the document in front of it, and it does so unconditionally. In particular `keepId` does not affect it, which is worth knowing because `keepId` is what adventure import uses and it would be a reasonable thing to suspect:

```js
game.items.fromCompendium(doc, { keepId: false })  // _id: undefined, source: Compendium.dnd5e.items.Item.00BggOkChWztQx6R
game.items.fromCompendium(doc, { keepId: true })   // _id: 00BggOkChWztQx6R, source: Compendium.dnd5e.items.Item.00BggOkChWztQx6R
```

`keepId` governs the id and nothing else. The staleness never came from that option; it came from adventure import not calling this function at all.

That stamp is what makes adventure content referenceable at all. An adventure's contents are embedded data rather than documents, so they have no UUID and `fromUuid` cannot reach them, which is why anything out of an adventure could otherwise only ship as a copy. Knowing the adventure and the id, graft resolves one form of its own, written to read like the embedded UUIDs Foundry already uses:

```
Compendium.madv-fleshmountain.madv-fleshmountain-adventure.Adventure.CeteW6YgiNUi0Ykn.JournalEntry.azXUvCHjdm7k31my
```

This is the only source graft resolves itself instead of handing to `fromUuid`. The alternative was putting somebody's entire adventure text inside a patch.

It only helps adventures imported *after* graft is installed. For anything already in your world the fallback below applies.

So an unresolvable source splits two ways. If the package is **installed but disabled**, that is yours to fix and the export refuses until you enable it. If it is **not installed at all**, it may not be obtainable by anyone, so the export treats the document as having no recorded source: in a world pack it references itself, and in the world it travels whole. Travelling whole puts the content in your `grafts.json`, which is visible in the file, and whether you may distribute it is your call.

### Whole documents and deltas look alike

A merge patch is shaped like the document it patches. That is why `grafts.json` is readable, and it is why a complete document and a partial one cannot be told apart by looking at them. Both are an object with an `_id` and some fields.

Nothing needs to tell them apart at build time, because context answers it: `mergeById` sees whether the id is already there, and `hydrateOne` sees whether the entry named a `source`. Absent either, the base is empty and the patch *is* the document.

Export is the one place the base has gone out of scope, so the fact travels explicitly. `diff` records which entries it had no prior for, and only those can be turned into references. Guessing from shape instead got it wrong both ways: documents with no `type` field (journals, scenes, roll tables, which are most of an adventure) were never referenced and had their text copied, and renaming *and* retyping one item looked like a whole document, which then diffed against the full source and nulled out every field it did not mention.

### Sets look like ordered lists

Foundry's `SetField` serialises to an array, and dnd5e uses eleven of them (`system.properties` among them). A Set has no meaningful order, but an array compared by equality does, so a source that happens to serialise `["mgc", "gear"]` where your copy has `["gear", "mgc"]` reads as a change when nothing changed.

Not currently handled, because the data does not say which arrays are Sets and guessing costs something either way: comparing every scalar array order-insensitively would silently drop a genuine reordering of a list that is meant to be ordered. Worth revisiting if spurious `properties` lines turn out to be common.

### `null` on a schema field resets it, it does not remove it

RFC 7386 says `null` deletes a key, and it does: the key leaves the patched data. But Foundry then loads that data against a schema, and a field the data omits takes its declared initial value. So `system.details.cr: null` does not produce an actor without a CR, it produces one with the schema's default CR.

Deletion only truly removes a key where the schema does not describe it, which in practice means `flags` and other free-form objects. Worth knowing before writing a patch that expects a field to disappear.

### What it cannot say

**Removing an entry from a keyed array.** Merge-by-id reads an omitted entry as "leave it alone", so there is nowhere to say "drop this one". Expressing it means RFC 6902 `remove` ops, which address positionally and break under exactly the reordering that keying by `_id` exists to survive. Documented rather than fixed, and there is a test asserting the round trip declines to represent it rather than silently shipping a patch that does nothing.

## Authoring

Nobody writes these by hand. Foundry stamps `_stats.compendiumSource` on any document imported from a compendium, so the source is already recorded: import the monster, edit it in the ordinary sheet, and `diff(source, yours)` recovers what you changed.

The property everything rests on is the round trip:

```js
applyPatch(source, diff(source, mine))   // deep-equals mine
```

## Dependencies

A graft module declares what it is built on through Foundry's own `relationships`, with version ranges, and Foundry reports a missing or mismatched one itself. That is better than anything a module could do from inside, and it is the piece a live-synced vault can never have.

The distinction that matters is which kind:

- **`requires`** for what the module cannot function without: graft itself, and the game system its packs declare. Foundry refuses to let the reader disable these while your module is enabled.
- **`recommends`** for the content you graft *onto*. A missing source skips its own entries and names them, and everything else still builds, so hard-requiring one turns a degradation into a wall. It also makes the module untestable against a missing dependency, since the reader cannot disable it without disabling yours.

Pinning a range answers identity: within a pinned version the source ids are stable, because it is the same artifact. What a range does not tell you is whether the *specific document* you diffed changed within it. RFC 6902 `test` ops would close that at document granularity, if it turns out to matter.

## Layout

```
scripts/patch.mjs   the format: applyPatch, diff. Pure, no Foundry.
scripts/plan.mjs    ids, UUIDs, and the order a chain has to build in.
scripts/yaml.mjs    what lands on the clipboard.
scripts/hydrate.mjs the parts that need Foundry: resolve, unlock, write.
scripts/main.mjs    hooks, the sheet control, reading grafts.json.
test/               properties of the three pure modules.
module.json         Foundry manifest.
```

## Graft is a library

It ships code and no content, and it is system-agnostic: the only Foundry fields it knows about are `_stats`, `ownership` and `folder`, which are core, and `fromUuid` and `getDocumentClass`, which are core too.

That is not a stylistic choice. Foundry requires an Actor or Item pack to declare the system it depends on, so a module shipping those packs cannot be system-agnostic. Your own module declares the packs, the system and the dependencies; graft builds them.

```jsonc
// your-adventure/module.json
"packs": [
  { "name": "your-actors", "path": "packs/your-actors", "type": "Actor", "system": "dnd5e" }
],
"relationships": { "requires": [
  { "id": "graft", "type": "module" },
  { "id": "dnd5e", "type": "system" },
  { "id": "dnd-monster-manual", "type": "module" }   // whatever your grafts point at
]}
```

Then `grafts.json` beside it, and:

```js
game.modules.get("graft").api.buildPacks("your-adventure")
```

`examples/graft-example/` is a complete one.

## Authoring a graft module

**1. Make the module.** A directory in `Data/modules/` with a `module.json`, declaring the packs you want, `requires` for graft and your system, and `recommends` for each source you graft onto. `examples/graft-example/` is a working one.

**2. Restart the Foundry server.** Manifests are read at startup, so a pack you just declared is invisible until then. A browser reload is not enough, and the symptom is a build complaining that your module declares no such pack.

**3. Build the content in your world, the ordinary way.** Import somebody's monster and edit it. Drag items onto it. Make the things that are yours from scratch. Nothing here is graft-specific: you are just playing with Foundry.

**4. Take the grafts.** Either **Copy graft** in a document's sheet header, one at a time, or gather the work in a world compendium and press **Copy grafts** in that pack's window header to take the whole array at once. Paste into `grafts.json` beside your `module.json`. The `pack` field is filled in for you when your module declares exactly one pack of that type; otherwise add it.

Assembling in a pack first is usually the better way round: make a world compendium, drag in the things you have imported and edited and the things you invented, and export the lot in one press. A document that graft itself built exports as the graft it was, not as a reference to itself, so a pack can be re-exported after edits.

**5. Build**, from the prompt on load or the Build grafts control in your pack's window header, and check the report.

**6. Test what a reader without your sources gets.** Disable one of the modules you graft onto and build again. Those entries should skip and name themselves while everything else still builds. This is worth doing: it is the difference between a module that degrades and one that half-builds.

> [!WARNING]
> **Do not distribute the `packs/` directory.**
>
> Building writes the *resolved* documents into your module's packs, and those contain everything that was fetched: the descriptions, the stat blocks, the map. Publishing the module directory after testing therefore ships all of it, which is exactly what this format exists to avoid.
>
> A graft module is `module.json`, `grafts.json`, and whatever art and code are genuinely yours. Nothing else. Add `packs/` to your `.gitignore` and exclude it from any zip you build.

## Using it

Nothing here needs a console.

**Installing.** When a graft module is enabled and has entries it has not built, graft offers to build them on the next world load. Asked once per module and remembered, because a prompt that returns every load is one people learn to dismiss without reading. Declining is not permanent.

**Rebuilding.** A **Build grafts** control sits in the header of that module's own compendium windows, which is where somebody looks when they wonder why a pack is empty. Use it after installing a source you were missing, or when the module ships new entries.

**Authoring.** Import a document from somebody's compendium, edit it in the ordinary sheet, and press **Copy graft** in the sheet header. Foundry already recorded where it came from, so the patch is recovered against that and put on the clipboard. Paste it into your `grafts.json`.

A build reports what happened in a window: what was not built and why, first, because that is the part somebody can act on, and a collapsed list of what was, whose entries are content links you can click through to. Results land in the **Compendium** tab under that module's packs, not in the Actors or Items sidebar. Entries whose source does not resolve are skipped and named, so a reader missing one dependency still gets everything else.

Whether an entry is built is decided by reading the pack index rather than a stored flag, so a hand-deleted document and a module update shipping new entries both answer honestly.

A module's packs are locked by default, so each is unlocked for the write and put back exactly as found. Leaving one unlocked would quietly invite hand edits that the next build overwrites.

`game.modules.get("graft").api` exposes the same things for scripting: `buildPacks(moduleId)`, `unbuilt(moduleId)`, `exportDiff(document)`.

Run the tests with `node --test 'test/*.test.mjs'`.
## Moulinette

Shipped with graft, registered only when the Moulinette module is enabled, so a reader who does not use it never sees it mentioned.

```
@moulinette/<pack_ref>/<filepath>
@moulinette/10698/scenes/abandoned-mine-entrance.webp
```

`pack_ref` is the number in a marketplace URL. The two slugs beside it there are display names run through `.slugify()`, so they change when a creator renames a pack; the number does not.

As an entry's `source` it names a **document**, which is fetched, patched, and returned as a sourceless entry carrying the result. Anywhere inside a patch it names a **file**, which is downloaded and rewritten to a local path. A reference that will not resolve takes its container with it and no further: a `background` with no `src` is worse than no background, but one missing ambience must not discard a whole scene. Everything dropped is named in the build report.

Nothing is redistributed. The reader's own subscriptions decide what they get, which is the same argument as referencing a compendium they own, extended to a cloud they have rights to.

## Providers

A provider rewrites entries before anything is built. Register one at the `graftRegisterProviders` hook, which fires at `ready` so a provider never has to care whether its module loaded first:

```js
Hooks.on("graftRegisterProviders", ({ registerProvider }) => {
  registerProvider({
    id: "moulinette",
    label: "Moulinette",
    async hydrate(entries) {
      // Every entry the module declares, from every file it declares them in.
      return { entries, skipped: [], enqueue: [] };
    },
  });
});
```

`hydrate` receives the merged array and returns an array, or `{ entries, skipped, warnings, enqueue }`, or nothing to leave things alone. `skipped` and `warnings` both use the `{ id, reason }` shape the builder does, so they reach the same report the reader already reads, sectioned by provider. Build as much as possible and report the rest.

Warnings are for a document that builds but not as intended, and a provider often knows things the builder cannot. Moulinette strips `_stats` on the way past and hands back an entry with no source, so it is the only place that can tell whether the fetched document predates this Foundry.

**Providers run from a queue, not to a fixed point.** "Is there work left" is answerable; "has anything changed" is not. A provider that emits syntax another provider handles names it in `enqueue`, because the one producing the syntax is the only one that knows it did. The queue deduplicates against what is *pending* rather than what has run, so a provider re-runs for input that did not exist when it first ran, which is the point. Two providers can still take turns forever, so each is capped and the report names whichever one would not settle.

`hydrate` should be idempotent, and a provider may not enqueue itself: the honest version of that is "I have not finished", which is something to do before returning.

**The shape to aim for.** A provider does not need a pack of its own. Fetch what an entry names, apply its patch to that JSON, and return a sourceless entry carrying the result: `hydrateOne` treats a missing `source` as "the patch is the document", so there are no ids to collide and no compendium to own. Record where it came from in `flags.graft`, since a blank `source` otherwise loses the trail. Doing it this way also keeps the provider a plain array-to-array transform, which is testable without Foundry.

