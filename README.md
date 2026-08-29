# Graft

[![tests](https://github.com/wizzlethorpe/graft/actions/workflows/test.yml/badge.svg)](https://github.com/wizzlethorpe/graft/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/wizzlethorpe/graft)](LICENSE)
[![release](https://img.shields.io/github/v/release/wizzlethorpe/graft?display_name=tag&sort=semver)](https://github.com/wizzlethorpe/graft/releases/latest)

Package your changes to somebody else's compendium content as a **diff**, and hydrate it on the reader's machine. The artifact carries pointers and patches, never the content.

A graft joins your scion to somebody else's rootstock. The result grows as one plant, but you only supplied the shoot.

> [!IMPORTANT]
> **Your content is your responsibility.** Graft ships pointers and patches by design, but that is a design property, not a legal opinion. A patch can still reproduce protected material: a description rewritten in full, a stat block restated, a map's whole wall layout. Graft cannot tell the difference, and it does not check entitlement — it resolves whatever UUIDs an entry names against whatever the reader has installed.
>
> Check what your grafts contain before publishing, and honour the licences of what you build on.

**Install:** paste this into Foundry's *Install Module* dialog.

```
https://github.com/wizzlethorpe/graft/releases/latest/download/module.json
```

**Status:** working prototype, exercised in a live world across Actors, Items, Scenes, Journals, Playlists and Adventures. Not on Foundry's package registry; the format may change.

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

Hydration resolves the source, applies the patch, and creates the result under your id in your pack. An unresolvable source skips that entry and names it; everything else still builds.

**`folder`** is optional and is a path of names, not an id:

```yaml
folder: Magic Items/Bags
```

Ids mean nothing on another machine, but the shape you organised your work into is worth keeping. Folders are created on the way in, matched by name and parent, so renaming one by hand survives the next build.

**`source`** is optional. Without one, the patch *is* the document, carried whole — a graft module is an adventure, not only a pile of derivatives. Present but empty is an error.

## Authoring

**1. Make the module.** A directory in `Data/modules/` with a `module.json` declaring your packs, `requires` for graft and your system, and `recommends` for each source you graft onto. `examples/graft-example/` is a working one.

**2. Restart the Foundry server.** Manifests are read at startup. A browser reload is not enough; the symptom is a build saying your module declares no such pack.

**3. Build in your world, the ordinary way.** Import a monster and edit it, drag items onto it, make the things that are yours. Nothing here is graft-specific.

**4. Take the grafts.** Right-click a document in the sidebar for **Copy graft**, or right-click a folder for **Copy grafts** to take everything in it and its subfolders. The sheet header has the same control for something already open. Paste into `grafts.json` beside your `module.json`.

**5. Build**, from the prompt on load or **Build grafts** in your pack's window header, and read the report.

**6. Test what a reader without your sources gets.** Disable a module you graft onto and build again. Those entries should skip and name themselves while everything else builds.

> [!WARNING]
> **Do not distribute the `packs/` directory.** Building writes the *resolved* documents into your packs — descriptions, stat blocks, maps and all. Publishing the module directory after testing ships everything this format exists to avoid.
>
> A graft module is `module.json`, `grafts.json`, and whatever art and code are yours. Add `packs/` to `.gitignore`.

### Copying runs one way

**Copy graft** works in the world, not from compendiums. The world is where you build; a compendium is where graft puts what it builds.

What you get depends on where the document is:

| Document | Result |
|---|---|
| In a pack anyone can install | A reference with an empty patch: *include this, unchanged* |
| In a world pack, or the world, with a recorded source | A real diff against that source |
| Yours, with no recorded source | Carried whole |

The first case is asked first, and it is what makes chaining work: **Copy graft** on a document graft built answers "reference this" rather than replaying the patch that produced it.

## Using it

Nothing needs a console.

- **Installing.** When a graft module has unbuilt entries, graft offers to build on the next world load. Asked once per module and remembered; declining is not permanent.
- **Rebuilding.** **Build grafts** sits in the header of that module's compendium windows.
- **The report** shows what was not built and why first, then anything built with warnings, then a collapsed list of successes as clickable links. Results land in the **Compendium** tab.

Whether an entry is built is read from the pack index, not a stored flag, so hand-deleting a document and shipping new entries both answer honestly. Packs are unlocked for the write and put back exactly as found, including their folder assignment.

```js
game.modules.get("graft").api    // buildPacks, unbuilt, exportDiff, registerProvider
```

Tests: `node --test 'test/*.test.mjs'`

## Chaining

`id` is a Foundry document id, not a slug, so your output is addressable:

```
Compendium.<module>.<pack>.<Type>.<id>
```

Grafting onto a graft is therefore not a special case — somebody names your output the way they would name anything else, and your module is an ordinary dependency of theirs.

What does change is **order**. `planOrder` sorts entries so anything grafted onto a sibling comes after it, and refuses two that graft onto each other rather than half-building them. Sources outside the module need no sequencing; Foundry reports a missing dependency better than we could.

The open risk is drift: if the base you built on rebuilds against a new source, your patch may still apply and mean something else.

## Dependencies

Declare them through Foundry's own `relationships`, so Foundry reports a missing one itself.

- **`requires`** for what the module cannot work without: graft, and the system its packs declare. Foundry stops the reader disabling these.
- **`recommends`** for content you graft *onto*. A missing source skips its own entries and builds the rest, so hard-requiring one turns a degradation into a wall — and makes the module untestable against a missing dependency.

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

`entries` defaults to `grafts.json`; a declared file that cannot be read is a warning, a missing default one is not.

A grafts file may be a bare array, or an object declaring the format it was written for:

```json
{ "format": 1, "entries": [ … ] }
```

Absent means 1. A file declaring a newer format is refused rather than half-read, since the fields it relies on would otherwise be ignored in silence. `packs` only affects **Copy graft**, which otherwise guesses when your module has exactly one pack of that type and gives up when it has two.

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

`hydrate` receives every entry the module declares, from every file, and returns an array, or `{ entries, skipped, warnings, enqueue }`, or nothing. `skipped` and `warnings` use the builder's `{ id, reason }` shape and reach the same report, sectioned by provider. Build as much as possible and report the rest.

**Providers run from a queue, not to a fixed point.** "Is there work left" is answerable; "has anything changed" is not. A provider emitting syntax another handles names it in `enqueue`, since the producer is the only one that knows. The queue deduplicates against what is *pending*, not what has run, so a provider re-runs for input that did not exist when it first ran. Mutual recursion is capped and the report names whichever provider would not settle.

`hydrate` should be idempotent, and may not enqueue itself.

**The shape to aim for:** fetch what an entry names, apply its patch to that JSON, and return a sourceless entry carrying the result. No pack of your own, no ids to collide. Record provenance in `flags.graft`. This also keeps the provider a plain array-to-array transform, which is testable without Foundry — and a provider is often the only thing that sees the original, so warnings usually have to come from there.

## Moulinette

Ships with graft, registered only when the Moulinette module is enabled.

```
@moulinette/<pack_ref>/<filepath>
@moulinette/10698/scenes/abandoned-mine-entrance.webp
```

`pack_ref` is the number in a marketplace URL. The slugs beside it are display names and change when a pack is renamed; the number does not.

As an entry's `source` it names a **document**, fetched and patched. Inside a patch it names a **file**, downloaded and rewritten to a local path. A reference that will not resolve takes its container with it and no further: a `background` with no `src` is worse than no background, but one missing sound must not discard a scene. Everything dropped is named in the report.

Nothing is redistributed — the reader's own subscriptions decide what they get.

## Format details

[RFC 7386](https://www.rfc-editor.org/rfc/rfc7386) (JSON Merge Patch), because a patch that mirrors the document it patches is one a person can read, and `null` already means "delete this key". [RFC 6902](https://www.rfc-editor.org/rfc/rfc6902) is more expressive and its `test` op would give drift detection for free, but it addresses array members positionally.

**The one departure: arrays whose members all carry `_id` merge by that key. Everything else replaces.** Foundry's arrays are collections of embedded documents whose order is not meaningful, so changing one item's damage should not mean restating forty, and should not break when the source reorders them.

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

The second is recovered automatically — Foundry recorded where the item came from, so **Copy graft** references it rather than copying it. An embedded source that will not resolve refuses the whole entry, because a statblock quietly missing the item it was built around is worse than one that names the dependency.

### What is stripped

- **`_stats`**, whose timestamps differ between identical documents and would report every embedded item as changed.
- **`folder`**, at the root only. It is kept at depth, which matters for Adventures: those carry their own `folders` array and their documents point into it.
- **`ownership`** is thinned rather than dropped. Per-user entries are world-local; `default` stays, since it is how you say "players can see this".

Nothing else, and in particular **no other module's flags**. Tidying those would be an editorial judgement about somebody else's data.

### Drift

A patch is written against a source at a moment in time. Three things say that moment has passed, and all three **warn** rather than refuse — a changed source usually still patches correctly, and refusing would strand a reader over an upstream typo.

- **A different system.** `_stats.systemId` says what a document was authored for. A pf2e actor grafted into a dnd5e world is not drift, it is incompatible, and it otherwise builds in silence.
- **An older generation.** Foundry or system majors only. Systems ship minors constantly and most break nothing, so warning on each would train people to skip the section.
- **The source itself changed.** An entry records `sourceHash`, a digest of the source **projected onto the patch's shape** — only the fields the patch touches:

```yaml
source: Compendium.some-bestiary.actors.Actor.mmBandit000000
sourceHash: 7f3a91c2e40b8d15
patch:
  system: { attributes: { hp: { value: 45 } } }
```

Projecting is what makes it usable. An upstream typo fix in a description you never touched must not warn, or the warning becomes noise. Reordering a keyed array is not drift either, and neither is key order in the source.

An entry with no `sourceHash` is silent: absent means "not recorded", not "verified clean".

### Old documents are migrated

Everything is created through `Document.fromImport`, Foundry's own migration path. Creating directly lands old data unchanged against the current schema, and the failure is quiet: a Foundry 13 scene arrives with v13 tile coordinates read under v14 anchor semantics, so every tile sits half its own size out of place.

A source older than the running generation is still reported, since migration handles fields that moved but not one removed outright.

### `compendiumSource` is not provenance

Foundry stamps it on anything imported from a pack, which is what lets **Copy graft** recover a diff without you typing a UUID. But it records where a document was last imported from *by whoever imported it*. Publishers often assemble in a private work module, and that id survives into published content, naming something nobody else can install.

Graft records its own answer where it can: `preImportAdventure` stamps `flags.graft.origin` with the adventure's UUID, which is real, and that is preferred when present. Ordinary imports need no help — `fromCompendium` writes an accurate source itself, regardless of `keepId`.

That stamp is also what makes adventure content referenceable. An adventure's contents are embedded data, not documents, so they have no UUID of their own. Graft resolves one form itself, written like the embedded UUIDs Foundry already uses:

```
Compendium.<module>.<pack>.Adventure.<advId>.JournalEntry.<docId>
```

An unresolvable source splits two ways. **Installed but disabled** is yours to fix, and the export refuses until you enable it. **Not installed at all** may be nobody's to fix, so the document is treated as having no recorded source and travels whole — which puts its content in your `grafts.json`, visible in the file, and your call to make.

### Limits

- **Removing an entry from a keyed array** is not expressible: an omitted entry means "leave it alone". Saying otherwise needs RFC 6902 `remove`, which addresses positionally.
- **`null` resets, it does not remove.** The key does leave the patched data, but Foundry then loads it against a schema and an absent field takes its declared initial value. True deletion only works where the schema does not describe the key, in practice `flags`.
- **Sets serialise as ordered arrays.** `SetField` has no meaningful order but compares as a list, so a reordering reads as a change. Not handled, because guessing which arrays are Sets could silently drop a genuine reorder of a list that *is* ordered.
- **Stale entries are not removed.** Deleting an entry from `grafts.json` leaves what it built behind.

## Layout

```
scripts/patch.mjs      the format: applyPatch, diff, stripVolatile. Pure.
scripts/plan.mjs       ids, UUIDs, and the order a chain must build in.
scripts/providers.mjs  the provider queue. Pure.
scripts/yaml.mjs       what lands on the clipboard. Pure.
scripts/hydrate.mjs    what needs Foundry: resolve, migrate, unlock, write.
scripts/modules.mjs    what a module declares.
scripts/moulinette.mjs the Moulinette provider.
scripts/origin.mjs     where a document really came from.
scripts/progress.mjs   the build's progress bar.
scripts/ui.mjs         controls, menus, dialogs.
scripts/main.mjs       hooks, and nothing else.
```

Graft ships code and no content, and is system-agnostic: the only Foundry fields it knows are `_stats`, `ownership` and `folder`. That is not stylistic — Foundry requires an Actor or Item pack to declare its system, so a module shipping packs cannot be system-agnostic. Your module declares the packs, the system and the dependencies; graft builds them.
