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
- fa-battlemaps assets cannot be fetched for a reader. Its compendium ships
  every scene document, so `Compendium.fa-battlemaps.maps.Scene.<id>` works as an
  ordinary source and the scene builds; what a reader lacks is the image and
  audio files, which FA gates behind Patreon and fetches on demand. There is no
  entry point to ask it for them: `scripts/fa-battlemaps.js` is an ES module with
  no exports and no global, so `FABattlemaps` and `FADownloader` are unreachable,
  and `game.faBattlemaps` is data with no methods. FA only intercepts Import from
  its own compendium, so a scene built into a graft module's pack gets none of
  that. Driving FA's HTTP API directly would mean reimplementing an undocumented
  third-party client, including its Patreon check, so the reader downloads the
  map in FA's own window instead.
- No gesture updates an existing entry's patch. Build an entry, import it into
  the world, edit it, and **Copy graft** names your own built document, which
  `planOrder` refuses as a self-cycle if pasted over the original. Rewinding one
  hop to the entry's own source would fix it for an author and break it for a
  reader chaining onto somebody else's graft module, and graft cannot tell the
  two apart; `withPack` has the same blind spot.
- `hydrate`, `ui` and `modules` have no test coverage. `exportDiff` now does,
  through a stub, and the same approach would cover the rest if it earns it.

## Wanted

- `graft-moulinette`, a companion module. Graft went offline in 0.7.0 and knows
  nothing about Moulinette; this is where that knowledge lands. The design:
  - One declared compendium pack per document type. A source reads
    `Compendium.graft-moulinette.scenes.Scene.<id>` where the id is a hash of
    the Moulinette pack number plus in-pack filepath, so the UUID is the
    marketplace address in Foundry's alphabet. Hashes do not reverse, but the
    reader's own index enumerates every candidate to hash against.
  - Author side, no interaction: every Moulinette import funnels through
    `downloadAsset` on the `mou-cloud-cached` collection, and the world document
    lands through ordinary `createScene`. Wrap the former, and when the scene
    arrives, write the document into the pack under its deterministic id and
    stamp `_stats.compendiumSource` on the world copy. Copy graft then works
    with no Moulinette code in graft. `api.import(...)` as the fallback for
    content imported before the module existed, since the wrapper is
    forward-only.
  - Reader side: a `graftPreBuild` transform materialises any of its sources not
    yet in its packs, via the index and `downloadAsset`, which also pulls the
    document's files. A `graftBuilt` listener then scans the built documents for
    `moulinette-v2/cloud/<creator>/<pack>/<filepath>` paths and downloads what
    is missing to the exact path named. The folder-to-pack map comes off the
    index: a row's `previewUrl` ends in a name built from its own `url`, and
    cutting that name off leaves the two folder segments beside its `pack_id`.
  - Known holes to carry over: a creator renaming a pack changes the slug
    embedded in paths; ScenePacker packs and `cloud-private/` content are not
    in the asset index; an S3 reader's paths sit behind a base URL the shipped
    document lacks; scanning only reverses a path that is the whole string,
    since one inside a journal page's markup would resolve nowhere.
- An `fa-nexus` companion module, same shape: paths under the world-configured
  `cloudDownloadDirAssets`/`cloudDownloadDirTokens` roots are FA's own catalog
  tree, resolvable through the exported `NexusContentService` and
  `NexusDownloadManager`. Deferred: Nexus users typically may redistribute the
  art anyway. Never treat `__generated/`, `exports/` or `masks/` as catalog
  content; the flattened map a scene actually uses exists only on the machine
  that made it.
