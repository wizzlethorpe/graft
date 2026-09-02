# Graft

[![tests](https://github.com/wizzlethorpe/graft/actions/workflows/test.yml/badge.svg)](https://github.com/wizzlethorpe/graft/actions/workflows/test.yml)
[![license](https://img.shields.io/github/license/wizzlethorpe/graft)](LICENSE)
[![release](https://img.shields.io/github/v/release/wizzlethorpe/graft?display_name=tag&sort=semver)](https://github.com/wizzlethorpe/graft/releases/latest)

Graft packages your changes to somebody else's compendium content as a **diff** and rebuilds the result on the reader's machine. A graft module ships pointers and patches, not the content it builds on.

The name comes from horticulture: a graft joins a shoot (the scion) to another plant's roots (the rootstock).

**Install:** paste this into Foundry's *Install Module* dialog.

```
https://github.com/wizzlethorpe/graft/releases/latest/download/module.json
```

> [!IMPORTANT]
> **Your content is your responsibility.** A patch can still reproduce protected material: a description rewritten in full, a stat block restated, a map's whole wall layout. Graft cannot tell the difference and does not check entitlement; it resolves whatever UUIDs an entry names against whatever the reader has installed.
>
> Check what your grafts contain before publishing, and honour the licences of what you build on.

## An entry

A graft module is a list of entries in `grafts.json`: an `id` and `type` of your own, the `pack` of yours the result lands in, a `source` to graft onto, and a `patch`.

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

Building resolves the source, applies the patch, and creates the result under your id in your pack. A source the reader does not have skips that entry and names it in the report; everything else still builds.

## The authoring loop

1. Make a module declaring your packs; `examples/graft-example/` is a working one. Restart the Foundry server so the manifest is read.
2. Build your content in the world, the ordinary way: import, edit, drag items on.
3. Right-click a document or folder for **Copy graft** and paste the result into `grafts.json`.
4. Build, from the prompt on world load or from **Build grafts** in a pack window's header, and read the report.
5. Test what a reader without your sources gets: disable a module you graft onto and build again.

> [!WARNING]
> **Do not distribute the `packs/` directory.** Building writes the resolved documents into your packs. A graft module is `module.json`, `grafts.json`, and whatever art and code are yours; add `packs/` to `.gitignore`.

## Documentation

- [The format](docs/format.md): every field, source fallbacks, patch rules, drift detection, chaining, limits
- [Authoring](docs/authoring.md): module setup, Copy graft, source recovery, dependencies, manifest options
- [Using it](docs/using.md): building, rebuilding, the report, importing a `grafts.json` somebody sent you
- [Hooks and API](docs/hooks.md): pre-build transforms, export rewriters, `game.modules.get("graft").api`

## Development

```
scripts/patch.mjs      the format: applyPatch, diff, stripVolatile. Pure.
scripts/plan.mjs       ids, UUIDs, and build order for chains.
scripts/extend.mjs     collects and runs pre-build transforms and export rewriters.
scripts/yaml.mjs       clipboard output. Pure.
scripts/hydrate.mjs    everything that needs Foundry: resolve, migrate, unlock, write.
scripts/modules.mjs    reads what a module declares.
scripts/import.mjs     building a grafts.json somebody sent you.
scripts/origin.mjs     recovers a document's true source.
scripts/progress.mjs   the build's progress bar.
scripts/ui.mjs         controls, menus, dialogs.
scripts/main.mjs       hooks only.
```

Tests: `node --test 'test/*.test.mjs'`

Graft ships code and no content, and is system-agnostic: the only Foundry fields it knows are `_stats`, `ownership` and `folder`. Foundry requires an Actor or Item pack to declare its system, so a module shipping packs cannot be system-agnostic. Your module declares the packs, the system and the dependencies; graft builds them.
