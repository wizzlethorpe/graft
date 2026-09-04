# The format

A graft module declares its entries in `grafts.json`, an object holding the format it was written for and an `entries` list, always a list even for one document:

```json
{ "format": 2, "entries": [ … ] }
```

Each entry is an `id` and `type` of your own, a `source` to graft onto, and a `patch`. `id` is a Foundry document id, sixteen characters of `[a-zA-Z0-9]`; `pack` names which of your module's packs the result lands in.

```json
{
  "id": "banditCaptain001",
  "type": "Actor",
  "pack": "my-actors",
  "source": "Compendium.dnd-monster-manual.actors.Actor.mmBanditCaptain0",
  "patch": {
    "name": "The Enforcer",
    "system": {
      "attributes": { "hp": { "value": 65 } },
      "details": { "cr": null }
    },
    "items": [
      { "_id": "w3cX0piuU875Hc2M", "system": { "damage": { "base": { "denomination": 8 } } } }
    ]
  }
}
```

In the patch, `null` deletes a key, per RFC 7386, and an array member carrying an `_id` patches the item it names while leaving the rest alone: here the captain's scimitar goes up a damage die, and the pistol and armor ride along untouched. [Patches](#patches) below has the full rules.

Building resolves the source, applies the patch, and creates the result under your id in your pack. If a source cannot be resolved, graft skips that entry and lists it in the report; every other entry still builds.

**`folder`** is optional and is a path of names, not an id:

```json
"folder": "Magic Items/Bags"
```

Folder ids do not survive to another machine, but the folder structure does. Graft creates folders during the build and matches them by name and parent, so renaming one by hand survives the next build.

**`source`** is optional. Without one, the patch is the whole document, so a graft module can also carry original content. A `source` that is present but empty is an error.

A `source` that is a bare document id names another entry in the same module. Nothing else a source may hold looks like one, since no document type name is sixteen characters and a bare id is not a UUID, so the short form is unambiguous. It is also portable: it survives the module being renamed, and an import into somebody else's world can resolve it against whatever packs it creates. What it cannot say is which pack it meant, so graft reports an id two entries share rather than guessing.

```json
"source": "banditCaptain001"
```

`source` may also be a list of fallbacks, tried in order:

```json
"source": [
  "Compendium.dnd-monster-manual.actors.Actor.mmBanditCaptain0",
  "Compendium.dnd5e.actors24.Actor.mmBanditCaptain0"
]
```

Graft uses the first source that resolves, so an author can prefer better content without requiring it. The entry fails only if none of them resolve. A list source records no `sourceHash`, because a hash is taken against the specific document the author diffed and a list does not say which one that was.

## Packaging

Where an entry ends up is decided by the pack it names, as declared in `module.json`. A pack declared with the entry's own `type` gets the entry as a document. A pack declared as `Adventure` gets one Adventure holding every entry that names it, whatever their types. The same entries ship as browsable compendiums or as a single import by changing only the manifest.

```json
"packs": [
  {
    "name": "tryk-adventure",
    "label": "Tryk Academy",
    "path": "packs/tryk-adventure",
    "type": "Adventure",
    "system": "dnd5e",
    "flags": {
      "graft": {
        "img": "modules/tryk/cover.webp",
        "caption": "A school of wizardry",
        "description": "<p>Everything the vault holds, in one import.</p>"
      }
    }
  }
]
```

The Adventure is named from the pack's `label`; `img`, `caption` and `description` come from `flags.graft` and are optional. Its id is derived from the module and pack names, so a reader re-importing an updated Adventure updates their world in place. Each entry's `folder` path becomes a folder inside the Adventure, one tree per document type, since Foundry folders are typed. A member that does not build this run keeps its place from the previous build, as an unbuilt entry keeps its document in an ordinary pack; only an entry no longer declared is dropped. An Adventure pack needs a `system` as much as an Actor pack does: Foundry empties the actors and items out of any Adventure read from a systemless pack.

An entry assembled into an Adventure is addressed as `Compendium.<module>.<pack>.Adventure.<advId>.<Type>.<id>`, the form graft resolves for any Adventure's contents, so grafting onto it works the same as onto a pack document, from the same module or another.

`Adventure` is not an entry type. An entry declaring one is refused with a reason.

## Patches

Patches use [RFC 7386](https://www.rfc-editor.org/rfc/rfc7386) (JSON Merge Patch), because a patch that mirrors the shape of the document is readable, and `null` already means "delete this key". [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) is more expressive, and its `test` op would give drift detection for free, but it addresses array members by position.

**The one departure: arrays whose members all carry `_id` merge by that key. Everything else replaces.** Foundry's arrays are collections of embedded documents with no meaningful order, so changing one item's damage should not require restating forty, and should not break when the source reorders them.

### Embedded content is a graft too

An embedded document can be somebody else's content as well, so an entry in a keyed array takes one of two shapes: a patch on an item already in the source, or a graft inside the graft, with a `source` and `patch` of its own.

```json
"items": [
  { "_id": "w3cX0piuU875Hc2M", "system": { "damage": { "base": { "denomination": 8 } } } },
  {
    "_id": "IP7kWWdq5km8SZad",
    "source": "Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt",
    "patch": { "system": { "equipped": true } }
  }
]
```

**Copy graft** produces the second shape for you: Foundry records where the item came from, so the entry references the item rather than copying it. An embedded source that will not resolve fails the whole entry, because a stat block silently missing the item it was built around is worse than a skipped entry that names the dependency.

An embedded source naming a sibling is an ordering edge like a top-level one, so an item can be declared as its own entry and put on an actor in the same file whichever order the two appear in. Graft reports a loop through an inserted item the same way as any other.

### What is stripped

- **`_stats`**, whose timestamps differ between identical documents and would report every embedded item as changed.
- **`folder`**, at the root only: a folder id from one world means nothing in another, and the entry's `folder` path carries the organisation instead.
- **`active`, `navOrder` and `thumb`**, at the root, which say where a Scene sat in the world it was copied from rather than what the scene is: which scene that world is looking at, where it sits in the navigation bar, and a path into that world's own generated thumbnails. `sort` is kept, since a graft may reasonably want to say where its output sits in a pack.
- **`ownership`** is thinned rather than dropped. Per-user entries are world-local, so graft removes them; `default` stays, since it is how you say "players can see this".

Nothing else is stripped, and in particular **no other module's flags**. Those are that module's data, and graft leaves them alone. A patch is a diff against a live document, so it carries whatever other modules have written on it: a flag one of them stamps in your world is a fact about your world, and it travels unless you take it out.

### Drift warnings

A patch is written against a source at a moment in time. Graft checks for three kinds of drift. All three **warn** rather than refuse, because a changed source usually still patches correctly, and refusing would strand a reader over an upstream typo fix.

- **A different system.** `_stats.systemId` records which system a document was authored for. A pf2e actor grafted into a dnd5e world is incompatible rather than merely drifted, and without this check it would build without any warning.
- **An older generation.** Foundry or system majors only. Systems release minors constantly and most break nothing, so warning on each would train readers to ignore the section.
- **The source itself changed.** An entry records `sourceHash`, a digest of the source **projected onto the patch's shape**, so only the fields the patch touches:

```json
{
  "source": "Compendium.dnd-monster-manual.actors.Actor.mmBanditCaptain0",
  "sourceHash": "a5bc24cd72abd37f",
  "patch": {
    "system": { "attributes": { "hp": { "value": 65 } } }
  }
}
```

Hashing only the patched fields keeps the warning useful: an upstream fix to a description you never touched does not warn. Reordering a keyed array is not drift, and neither is key order in the source.

A missing `sourceHash` means the hash was never recorded, so no drift check runs.

### Old documents are migrated

Graft creates everything through `Document.fromImport`, Foundry's own migration path. Creating directly would store old data unchanged against the current schema, and the failure is quiet: a Foundry 13 scene arrives with v13 tile coordinates read under v14 anchor semantics, so every tile sits half its own size out of place.

Graft still reports a source older than the running generation, since migration handles fields that moved but not fields that were removed.

An Adventure graft assembles is constructed from members that have already been migrated this way, since `Adventure.fromImport` itself migrates through a world collection Adventures do not have.

Import-time migration is also less complete than the migration Foundry runs when a world is upgraded. `fromImport` and `importFromJSON` alike drop a Foundry 13 tile's `occlusion.mode` rather than converting it to the `occlusion.modes` that replaced it, so a roof set to fade stops fading. Graft does not migrate fields by hand; the set of moved fields is open-ended.

### Limits

- **Removing an entry from a keyed array** is not expressible: an omitted entry means "leave it alone". Expressing removal would need RFC 6902 `remove`, which addresses by position.
- **`null` resets, it does not remove.** The key does leave the patched data, but Foundry then loads it against a schema, and an absent field takes its declared initial value. True deletion only works where the schema does not describe the key, in practice `flags`.
- **Sets serialise as ordered arrays.** `SetField` has no meaningful order but compares as a list, so a reordering reads as a change. Not handled, because guessing which arrays are Sets could silently drop a genuine reorder of a list that is ordered.
- **Pruning removes only what graft built.** Deleting an entry from `grafts.json` removes the flagged document it built on the next build; documents an author placed in the pack by hand are never touched. An entry a transform skipped this run, a lapsed subscription say, still counts as declared, and graft leaves it alone.

## Chaining

`id` is a Foundry document id, not a slug, so your output has a normal UUID:

```
Compendium.<module>.<pack>.<Type>.<id>
```

Grafting onto a graft is not a special case. Another author names your output the way they would name any document, and your module becomes an ordinary dependency of theirs.

Order does matter. `planOrder` sorts entries so that anything grafted onto a sibling in the same module is built after it, and refuses two entries that graft onto each other rather than half-building them. Sources outside the module need no sequencing; Foundry already reports a missing dependency.

The open risk is drift: if the base you built on is rebuilt against a new source, your patch may still apply and produce something different.
