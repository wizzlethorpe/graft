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

Pressing **Copy graft** works out which you have. A document living in a compendium already *is* a source, so it becomes a pure reference with an empty patch: include this, unchanged. One imported from a compendium is diffed against where it came from. One you wrote yourself travels whole.

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

### What is stripped, and what is not

Before diffing, at every depth:

- **`_stats` is removed.** Its timestamps and last-editor id differ between two identical documents, so leaving it in reports every embedded item as changed when none are.
- **`folder` is removed**, because an id names a folder in one world or pack. The path of names is carried on the entry instead, and rebuilt on the way in.
- **`ownership` is thinned, not removed.** The per-user entries are ids from one world and mean nothing elsewhere. `default` stays: it is the only way to say "players can see this" about a handout or a player-facing item, and that is an authorial decision rather than an accident of where the document was edited.

Nothing else, and in particular **no other module's flags**. A patch will carry whatever Scene Packer or anything else stamped on a document. That is noise, but a third-party flag is inert on apply if the reader lacks the module and possibly wanted if they have it. Tidying it would be an editorial judgement about somebody else's data, and would commit this to maintaining a list of other people's module names.

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
