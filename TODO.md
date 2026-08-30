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
- `hydrate`, `ui` and `modules` have no test coverage. `exportDiff` now does,
  through a stub, and the same approach would cover the rest if it earns it.
