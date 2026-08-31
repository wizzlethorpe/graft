# TODO

Short, and meant to stay short. Anything settled belongs in the README instead.

## Known limits

- Removing an entry from a keyed array is not representable. `mergeById` only
  sets, and an omitted entry means "leave it alone".
- `null` cannot distinguish "delete this key" from "set this to null", and
  Foundry has real nullable fields.
- Building a pack holding Scenes with Regions can raise "you may not update
  documents in the locked compendium" a handful of times just after the build,
  as visible error notifications. The stack is Foundry's own region system,
  `RegionDocument.updateDocuments` driven from the PIXI ticker, writing to a
  scene in a pack the build has already re-locked. It stops on its own after a
  few frames, is not tied to creating the scene (an update-only build raises it
  too, and another did not), and loses nothing.

  Not fixed, because every fix is a guess at a duration: the work is
  frame-scheduled and there is no signal for when it has finished. Delaying the
  re-lock would reduce it without closing it, and leaving packs unlocked to
  avoid it would be worse. Worth revisiting if a reader ever reports it as
  alarming, which it does look.
- Drift is reported, never refused, and a source with no recorded `sourceHash`
  is silent. Both deliberate: refusing would strand a reader over an upstream
  typo, and every `grafts.json` written before hashes existed has none.
- An Adventure migrates per content document (its class has no world
  collection, so `fromImport` on the whole crashes server-side); only a
  document whose own migration fails builds as authored.
- Import-time migration is less complete than a world upgrade. A Foundry 13
  tile's `occlusion.mode` is dropped rather than converted to `occlusion.modes`,
  by `fromImport` and `importFromJSON` alike, so a roof set to fade stops
  fading. Mapping renamed fields by hand is schema surgery on somebody else's
  data and has no natural end, so it is reported by the drift warning and left.
- The first prune after upgrading reclaims nothing. Only documents carrying
  `flags.graft.built` are eligible, and that flag did not exist before 0.2.0, so
  anything an earlier graft built is left alone. Correct and conservative: it
  refuses to delete what it cannot prove it made.
- Moulinette content cannot be copied back. Moulinette fires no hooks and stamps
  no flags, so a document it imported records only the publisher's private
  module as its source and **Copy graft** carries it whole. Reversing the local
  `moulinette-v2/...` paths would make such an entry portable but would not stop
  it carrying the map; only a document-level source would, and recovering one is
  inference. The provider does stamp `flags.graft.moulinette` on what graft
  itself builds, but `exportDiff` never reads it, so even that round trip
  re-expands. A `flags.moulinette = { pack_id, url }` stamp on import would close
  both, and has been asked for upstream.
- No gesture updates an existing entry's patch. Build an entry, import it into
  the world, edit it, and **Copy graft** names your own built document, which
  `planOrder` refuses as a self-cycle if pasted over the original. Rewinding one
  hop to the entry's own source would fix it for an author and break it for a
  reader chaining onto somebody else's graft module, and graft cannot tell the
  two apart; `withPack` has the same blind spot.
- `hydrate`, `ui` and `modules` have no test coverage. `exportDiff` now does,
  through a stub, and the same approach would cover the rest if it earns it.

## Wanted

- An `fa-battlemaps` provider. Its compendium ships every scene document, free
  and premium alike, so `Compendium.fa-battlemaps.maps.Scene.<id>` already works
  as an ordinary source; what a reader lacks is the map's image and audio files,
  which FA fetches on demand and gates behind Patreon. So the provider rewrites
  nothing and hands its entries back untouched: it downloads the assets for
  entries sourced from that pack and reports the auth wall once rather than once
  per entry. FA exposes no `.api`, so it means reaching `FABattlemaps` and
  `FADownloader` as internals, and skipping FA's own `onComplete`, which imports
  the scene into the world that graft is about to build. The one thing that
  would force a rewrite is a reader who changed FA's `download-path`.
- An `fa-nexus` provider. Unlike fa-battlemaps this one does rewrite, but only a
  prefix: below the root a Nexus path is FA's own catalog tree, and the root
  itself is the world settings `cloudDownloadDirAssets` and
  `cloudDownloadDirTokens`, so `@fa-nexus/assets/...` and `@fa-nexus/tokens/...`
  invert by stripping a prefix both machines can read, with nothing recorded.
  Three subtrees are not downloadable content and must never become references:
  `__generated/flattened`, `exports` and `masks/`. The first is the trap, since
  flattening a scene is how a Nexus map becomes portable at all, and the file it
  produces exists only on the machine that made it. Forge readers are a second
  case, since Nexus can store on `forgevtt` rather than `data` and their paths do
  not start with the root.
- Provenance for Moulinette content, without waiting on the developer. Every
  cloud download funnels through one method on the `mou-cloud-cached` collection,
  the object `loadIndex` already reaches: `downloadAsset(asset)`, which returns
  the document with each `#DEP#` already rewritten to the local pack folder. So
  `localPath.replace(folder + "/", "")` plus `asset.pack_id` reconstructs
  `@moulinette/<pack_id>/<file>` with no index lookup, at the one moment both
  halves are in the same place. Wrap it, keep the map in memory, and stamp
  `flags.graft.moulinette` in `preCreateScene`, the way `stampOrigin` already
  stamps adventure content. Three limits: it is forward-only, though a one-shot
  pass over the library could rebuild the map for what is already downloaded;
  ScenePacker packs fetch per pack rather than per document, so naming one scene
  needs a second ref shape built on the publisher id in `_stats.compendiumSource`;
  and `downloadAsset` is an internal, so it wants the same "not where graft
  expects it" check `loadIndex` makes rather than failing quietly.
- `exportDiff` reads no provenance out of `flags.graft`. Whatever writes it, the
  export side has to look before `stripVolatile` removes it, the way it already
  reads `_stats` for embedded sources. This is the piece that belongs in graft
  proper rather than in any one provider.
