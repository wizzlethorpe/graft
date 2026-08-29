# TODO

Short, and meant to stay short. Anything settled belongs in the README instead.

## Drift detection

A source whose `_stats.coreVersion` predates this Foundry generation is
migrated through `Document.fromImport` and warned about. What is not built is
the same check against `systemVersion`, and anything finer than a generation
number.

## Known limits

- Removing an entry from a keyed array is not representable. `mergeById` only
  sets, and an omitted entry means "leave it alone".
- `null` cannot distinguish "delete this key" from "set this to null", and
  Foundry has real nullable fields.
- Stale entries are not removed: deleting an entry from `grafts.json` leaves
  what it built behind.
- Creating a Scene in a pack can log "you may not update documents in the
  locked compendium" once, afterwards. Foundry generates a thumbnail for a
  scene that arrived without one and writes it back after the build has
  re-locked the pack. Cosmetic, only on first creation, and not worth a timing
  hack to chase.
- `exportDiff` has no test coverage. It needs Foundry, so every bug in it so far
  has been found by hand in a live world.
