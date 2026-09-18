# Graft

[![tests](https://github.com/wizzlethorpe/graft/actions/workflows/test.yml/badge.svg)](https://github.com/wizzlethorpe/graft/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/wizzlethorpe/graft)](LICENSE)
[![release](https://img.shields.io/github/v/release/wizzlethorpe/graft?display_name=tag&sort=semver)](https://github.com/wizzlethorpe/graft/releases/latest)
[![foundry](https://img.shields.io/endpoint?url=https://foundryshields.com/version?url=https://github.com/wizzlethorpe/graft/releases/latest/download/module.json&style=flat)](https://foundryvtt.com/packages/graft)


[Graft](https://foundryvtt.com/packages/graft) packages your changes to somebody else's compendium content as a **diff**, and rebuilds the result in somebody else's world. What travels is pointers and patches.

To install, simply search for **Graft** in Foundry's *Install Module* dialog.

> [!IMPORTANT]
> **Your content is your responsibility.** A patch can still reproduce protected material (a description rewritten in full, a stat block restated, a map's whole wall layout). Check what your grafts contain before publishing, and honour the licences of what you build on.

## Example

This example supposes you are running a D&D 5th Edition world in FoundryVTT.

**1. Build a Graft.** Import Bandit Captain from either the SRD or the Monster Manual, put it in a folder, and edit it in the ordinary sheet. For example, I renamed it to "The Enforcer", put its hit points up to 65, raised its CR, upgraded the scimitar to a d8, and deleted the pistol.

**2. Copy it.** Right-click the actor in the sidebar and choose **Copy graft**. The same control sits in the header of an open sheet, and **Copy grafts** on a folder takes everything in it and its subfolders. Your clipboard now holds a whole `grafts.json`:

```json
{
  "format": 4,
  "entries": [
    {
      "id": "banditCaptain001",
      "type": "Actor",
      "folder": "Harbor Raiders",
      "source": "Compendium.dnd-monster-manual.actors.Actor.mmBanditCaptain0",
      "sourceHash": "a5bc24cd72abd37f",
      "patch": {
        "name": "The Enforcer",
        "system": {
          "attributes": { "hp": { "value": 65 } },
          "details": { "cr": 4 }
        },
        "items": [
          { "_id": "w3cX0piuU875Hc2M", "system": { "damage": { "base": { "denomination": 8 } } } },
          { "_id": "2TB9ZSIbtbi4UtSv", "_delete": true }
        ]
      }
    }
  ]
}
```

Read it before you send it:

- **`source`** is a reference to the document you built on.
- **`patch`** is only what you changed, as an [RFC 7386](https://www.rfc-editor.org/rfc/rfc7386) merge patch. A key set to `null` removes it.
- In **`items`**, a member carrying an `_id` patches the relevant item, so the scimitar's damage die moves and nothing else about it does. An array carrying `_delete` drops it, which is how we specify that the captain should lose his pistol. Notice that the aspects of the document that were not touched in our edits are not mentioned in the graft.
- **`folder`** specifies where the document should be put.
- **`sourceHash`** digests the parts of the source your patch actually touches, so the reader is warned if that monster changes underneath your patch.

**3. Send it.** It is a text file. Paste it in Discord, put it in a gist, commit it to a repo. **Export graft**, beside **Copy graft**, saves it as a file instead of copying it.

**4. They import it.** On the Settings tab click **Import grafts**, paste the text or choose the file, then click **Build**. To try it on yourself, import it into the world you built it in: graft asks whether to replace the document you copied it from.

Graft resolves the source against the compendiums they have enabled in the world, applies your patch, and creates the object in their world.

A few things to know about grafts:

1. If a source cannot be resolved (i.e., because they don't own it), the corresponding entry will be skipped and a warning included in the report. Everything else will still build normally.
2. Grafts can point at each other. An entry is allowed to graft onto another entry in the same file.

## Art and other files

An `assets` block names files to fetch before anything builds, and graft's built-in `http` handler downloads them, with optional bearer auth and zip batching. See [Assets](docs/format.md#assets).

## Shipping it as a module

Past a certain size, you may want the reader to install something rather than paste something. A graft module carries the same `grafts.json` and offers to build it the first time they load a world with it enabled.

What the module path adds is a `module.json` declaring the packs your results get put in, and a `pack` on each entry naming one. Whether those entries arrive as browsable compendiums or as one importable Adventure is decided by the pack's declared type in the manifest.

> [!WARNING]
> **Do not distribute the `packs/` directory.** Building writes the resolved documents into your packs. A graft module is `module.json`, `grafts.json`, and whatever art and code are yours to distribute. Add `packs/` to `.gitignore`.

[Authoring](docs/authoring.md) walks through how to build a grafts-compatible module more thoroughly. Also, see `examples/graft-example/` for a working module to start from.

## Documentation

- [The format](docs/format.md): every field, sources, patch rules, drift warnings, packs, assets
- [Authoring](docs/authoring.md): module setup, Copy graft, source recovery, dependencies, manifest options
- [Hooks and API](docs/hooks.md): pre-build transforms, export rewriters, `game.modules.get("graft").api`

## Support

Graft is free and open source, from Wizzlethorpe Labs. If it is useful to you, [support us on Patreon](https://www.patreon.com/wizzlethorpe). More free tools and content at [wizzlethorpe.com](https://wizzlethorpe.com).

## Development

```
scripts/patch.mjs      the format: applyPatch, diff, stripVolatile. Pure.
scripts/plan.mjs       ids, UUIDs, and build order for chains.
scripts/assemble.mjs   folds entries aimed at an Adventure pack into one Adventure. Pure.
scripts/extend.mjs     collects and runs pre-build transforms and export rewriters.
scripts/assets.mjs     asset handlers, and the built-in http one.
scripts/zip.mjs        reads a zip in the browser, for the http handler. Pure.
scripts/paths.mjs      reading a file out of the Foundry data directory.
scripts/yaml.mjs       clipboard output. Pure.
scripts/i18n.mjs       localised text.
scripts/hydrate.mjs    everything that needs Foundry: resolve, migrate, unlock, write.
scripts/modules.mjs    reads what a module declares.
scripts/import.mjs     building grafts somebody sent you into the world.
scripts/build.mjs      one build, from a module or an import: assets, transforms, documents.
scripts/origin.mjs     recovers a document's true source.
scripts/progress.mjs   the build's progress bar.
scripts/ui.mjs         controls, menus, dialogs.
scripts/main.mjs       hooks only.
```

Tests: `node --test 'test/*.test.mjs'`
