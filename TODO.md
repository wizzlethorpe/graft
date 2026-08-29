# TODO

Short, and meant to stay short. Anything settled belongs in the README instead.

## Drift detection

The cheap half is built: a source whose `_stats.coreVersion` predates this
Foundry generation is built and warned about. What is not built is the same
check against `systemVersion`, and anything finer than a generation number.

## Known limits

- Removing an entry from a keyed array is not representable. `mergeById` only
  sets, and an omitted entry means "leave it alone".
- `null` cannot distinguish "delete this key" from "set this to null", and
  Foundry has real nullable fields.
- Stale entries are not removed: deleting an entry from `grafts.json` leaves
  what it built behind.
- A pre-14 Scene keeps a `background` that nothing reads: Foundry moves it into
  `levels` during a world migration, not on document creation, and
  `migrateData` does not do it either. Graft warns rather than rewriting it,
  since editing somebody's data to suit ours is what this module does not do.
- `exportDiff` has no test coverage. It needs Foundry, so every bug in it so far
  has been found by hand in a live world.
