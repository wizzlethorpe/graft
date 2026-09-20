# The format

A `grafts.json` holds the format version, a list of entries, and optionally the files to fetch before building:

```json
{ "format": 4, "entries": [ … ], "assets": { … } }
```

`entries` is always a list, even for one document. Graft reads files written in an older format, and refuses a newer one with a message asking you to update graft.

## Entries

```json
{
  "id": "banditCaptain001",
  "type": "Actor",
  "folder": "Harbor Raiders",
  "source": "Compendium.dnd-monster-manual.actors.Actor.mmBanditCaptain0",
  "patch": {
    "name": "The Enforcer",
    "system": { "attributes": { "hp": { "value": 65 } } }
  }
}
```

| Field | |
|---|---|
| `id` | A Foundry document id, sixteen letters and digits. The built document gets this id. |
| `type` | The document type: `Actor`, `Item`, `Scene`, `JournalEntry`, and so on. |
| `source` | Optional. What to graft onto; see [Sources](#sources). Without one, the patch is the whole document. |
| `patch` | What to change; see [Patches](#patches). |
| `folder` | Optional. A path of folder names, such as `"Magic Items/Bags"`. Graft creates missing folders and matches existing ones by name. |
| `pack` | Modules only. Which of the module's packs the result goes in; see [Packs](#packs). |
| `sourceHash` | Written by **Copy graft**, so graft can warn when the source changes; see [Drift](#drift). |

## Sources

A source names one document, in one of three forms:

- **A compendium UUID**, such as `"Compendium.dnd5e.actors24.Actor.mmBanditCaptain0"`.
- **Another entry's `id`** in the same file, to graft onto what that entry builds. Graft builds that entry first, whatever order they appear in, and refuses two entries that graft onto each other. Ids must be unique within a file.
- **A path to a `.json` file** in the Foundry data folder, such as `"graft/my-vault/bandit-captain.json"`, often one an asset handler placed. The file is the base document.

A patch is written against one document, so a source is never a list of documents to try. If the source does not resolve, graft skips that entry and names it in the report. Every other entry still builds.

## Patches

A patch is a [JSON merge patch](https://www.rfc-editor.org/rfc/rfc7386): it has the shape of the document and holds only what changes. A key set to `null` is removed.

Arrays are replaced whole, with one exception: when every member has an `_id`, as items and effects do, members merge by `_id` instead.

```json
"items": [
  { "_id": "w3cX0piuU875Hc2M", "system": { "damage": { "base": { "denomination": 8 } } } },
  { "_id": "2TB9ZSIbtbi4UtSv", "_delete": true },
  { "_id": "IP7kWWdq5km8SZad", "source": "Compendium.dnd5e.equipment24.Item.dmgAmuletOfHealt", "patch": { "system": { "equipped": true } } }
]
```

- A member with an `_id` patches the item with that id.
- A member whose `_id` the source does not have is a new member, and is added as written. It has to state whatever Foundry cannot fill in for that document type: for example, an Item needs a `name` and a `type`.
- A member whose `_id` the source does not have, and which leaves one of those out, is a mistake: `{ "_id": "...", "flags": { ... } }` is a change to an Item, not an Item, and there is nothing to apply it to. Graft skips the whole entry and the report names the member and the source. The usual causes are a mistyped `_id`, or a source whose members changed since the patch was written. The same goes for the `patch` of a member with its own `source`. A type Foundry can fill in entirely, such as a Token or a light, is never caught this way.
- A member with `"_delete": true` removes it.
- A member with its own `source` and `patch` is a graft inside the graft: the item is built from its source, then patched. If that source does not resolve, the whole entry is skipped. **Copy graft** writes items this way when Foundry recorded where they came from.
- Members the patch does not mention are left alone. `[]` removes every member.
- If any member lacks an `_id`, the whole array is replaced instead.

**Limits:**

- `null` resets rather than removes. Foundry fills a missing field with its default, so only keys under `flags` are truly deleted.
- Foundry's unordered fields compare as lists, so reordering one counts as a change.
- A document from an older Foundry is migrated by Foundry's own import, which drops some fields rather than converting them. For example, a Foundry 13 tile set to fade as a roof stops fading.

**Copy graft** leaves out what only makes sense in your own world: `_stats`, the folder id (the `folder` path replaces it), a Scene's `active`, `navOrder` and `thumb`, per-user `ownership` (`default` is kept), and graft's own flags. Other modules' flags are copied, so check for any you do not want to share.

## Drift

Graft warns, but still builds, when a source:

- was made for a different game system;
- was made for an older major version of Foundry or of the system;
- has changed since you copied it, in the fields your patch touches. **Copy graft** records this as `sourceHash`. An entry without one is not checked.

## Packs

This applies to modules only. An entry's `pack` names a pack declared in the module's `module.json`. If the pack's type matches the entry's, the entry becomes a document in it. If the pack's type is `Adventure`, every entry naming it goes into one Adventure. The manifest alone decides between browsable compendiums and a single import.

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

The Adventure is named by the pack's `label`, and takes `img`, `caption` and `description` from `flags.graft`. It needs a `system`, or Foundry empties the actors and items out of it. Each entry's `folder` becomes a folder inside it, and re-importing an updated Adventure updates the world in place.

Built documents have ordinary UUIDs, so other authors can graft onto them: `Compendium.<module>.<pack>.<Type>.<id>`, or `Compendium.<module>.<pack>.Adventure.<advId>.<Type>.<id>` inside an Adventure.

Removing an entry from `grafts.json` removes what it built on the next build. Documents you put in the pack by hand are not touched.

## Assets

`assets` names files to download before anything builds (e.g., art the entries point at, JSON files used as sources, etc.). It is keyed by handler, and the shape of a block belongs to its handler. Graft includes the `http` handler by default. Advanced modules can add others with [`graftAssets`](hooks.md). **Copy graft** writes a block for each installed handler that says the copied entries need one.

```json
"assets": {
  "http": {
    "auth": { "https://notes.example.com": "<bearer token>" },
    "files": [
      { "source": "https://notes.example.com/maps/harbor.webp?v=8f2c1a", "destination": "graft/my-vault/harbor.webp", "size": 812004 }
    ]
  }
}
```

Each file has a `source` URL, a `destination` in the Foundry data folder, and its `size` in bytes. `auth` optionally maps an origin to a bearer token. An entry refers to a downloaded file by its `destination`, not its URL: `"img": "graft/my-vault/harbor.webp"`.

`source` may be a list of URLs tried in order, and a URL may point into a zip with `#path/in/zip`. Graft downloads a zip whole when at least half its files are needed, and otherwise fetches files one at a time. Zips must be stored or deflated; zip64 is not supported.

A file is downloaded again only when it is missing, its URL has changed, or the server reports a new version. Put a version in the URL, such as `?v=3`, to force an update. Graft keeps its record in `graft/placed.json`. Deleting it makes the next build check every file again. When some files are already on disk, graft asks whether to keep them.

A key no installed handler recognises is reported, and everything still builds: a missing image shows as missing in Foundry. Only an entry whose source is a `.json` file that never arrived is skipped, since that file is its base document.

