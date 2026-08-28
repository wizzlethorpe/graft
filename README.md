# Graft

Package your changes to somebody else's compendium content as a **diff**, and hydrate it on the reader's machine. The artifact carries pointers and patches, never the content, so you can distribute work built on material you do not have the right to redistribute.

A graft joins your scion to somebody else's rootstock. The result grows as one plant, but you only ever supplied the shoot.

## Status

Prototype, untested in a live world. The format, the ordering and the YAML output are implemented and covered by 26 tests; the Foundry side is written but has never run.

## The format

Four fields. A source, a patch, and an id and type of your own.

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

### What it cannot say

**Removing an entry from a keyed array.** Merge-by-id reads an omitted entry as "leave it alone", so there is nowhere to say "drop this one". Expressing it means RFC 6902 `remove` ops, which address positionally and break under exactly the reordering that keying by `_id` exists to survive. Documented rather than fixed, and there is a test asserting the round trip declines to represent it rather than silently shipping a patch that does nothing.

## Authoring

Nobody writes these by hand. Foundry stamps `_stats.compendiumSource` on any document imported from a compendium, so the source is already recorded: import the monster, edit it in the ordinary sheet, and `diff(source, yours)` recovers what you changed.

The property everything rests on is the round trip:

```js
applyPatch(source, diff(source, mine))   // deep-equals mine
```

## Dependencies

A graft module declares what it is built on through Foundry's own `relationships.requires`, with a version range. Foundry then reports a missing or mismatched dependency itself, which is better than anything a module could do from inside, and is the piece a live-synced vault can never have.

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

## Using it

Two actions, both GM-only.

**Authoring.** Import a document from somebody's compendium, edit it in the ordinary sheet, and press **Copy graft** in the sheet header. Foundry already recorded where it came from, so the patch is recovered against that and put on the clipboard as YAML. Paste it into your `grafts.json`.

**Building.** `game.modules.get("graft").api.buildPacks()` reads `grafts.json` and hydrates every entry into this module's packs. Entries whose source does not resolve are skipped and named, so a reader missing one dependency still gets everything else.

A module's packs are locked by default, so each is unlocked for the write and put back exactly as found. Leaving one unlocked would quietly invite hand edits that the next build overwrites.

Run the tests with `node --test 'test/*.test.mjs'`.
