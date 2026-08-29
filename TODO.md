# TODO

Short, and meant to stay short. Anything settled belongs in the README instead.

## Drift detection

`_stats.coreVersion` and `systemVersion` record what a source looked like when a
patch was authored. Comparing them at build time would catch a patch reshaping a
document whose schema moved underneath it, which currently applies silently and
looks like it worked. Cheaper than RFC 6902 `test` ops for most of the benefit.

## Moulinette provider

The pipeline is built; the provider is not. It should fetch what an entry names,
apply the patch to that JSON, and return a sourceless entry, recording the
Moulinette URI in `flags.graft` so provenance survives the blanked `source`.

Errors want the same taxonomy the unresolved-source path uses, which is *whose
problem is it*: not signed in is the reader's, an unowned pack is the reader's
but a different action, an asset id that does not exist is the module author's,
and a network failure is nobody's. Advice that cannot help is worse than none.

Assets are the other half: rewriting a path and downloading a file, with no
document involved. A scene missing one of forty textures should still build,
and say so.

## Known limits

- Removing an entry from a keyed array is not representable. `mergeById` only
  sets, and an omitted entry means "leave it alone".
- `null` cannot distinguish "delete this key" from "set this to null", and
  Foundry has real nullable fields.
- Stale entries are not removed: deleting an entry from `grafts.json` leaves
  what it built behind.
- `exportDiff` has no test coverage. It needs Foundry, so every bug in it so far
  has been found by hand in a live world.
