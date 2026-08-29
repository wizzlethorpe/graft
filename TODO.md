# TODO

Short, and meant to stay short. Anything settled belongs in the README instead.

## Drift detection

`_stats.coreVersion` and `systemVersion` record what a source looked like when a
patch was authored. Comparing them at build time would catch a patch reshaping a
document whose schema moved underneath it, which currently applies silently and
looks like it worked. Cheaper than RFC 6902 `test` ops for most of the benefit.

## Known limits

- Removing an entry from a keyed array is not representable. `mergeById` only
  sets, and an omitted entry means "leave it alone".
- `null` cannot distinguish "delete this key" from "set this to null", and
  Foundry has real nullable fields.
- Stale entries are not removed: deleting an entry from `grafts.json` leaves
  what it built behind.
- `exportDiff` has no test coverage. It needs Foundry, so every bug in it so far
  has been found by hand in a live world.
