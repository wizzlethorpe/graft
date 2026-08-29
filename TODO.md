# TODO

Short, and meant to stay short. Anything settled belongs in the README instead.

## Known limits

- Removing an entry from a keyed array is not representable. `mergeById` only
  sets, and an omitted entry means "leave it alone".
- `null` cannot distinguish "delete this key" from "set this to null", and
  Foundry has real nullable fields.
- Creating a Scene in a pack can log "you may not update documents in the
  locked compendium" once, afterwards. Foundry generates a thumbnail for a
  scene that arrived without one and writes it back after the build has
  re-locked the pack. Cosmetic, only on first creation, and not worth a timing
  hack to chase.
- Drift is reported, never refused, and a source with no recorded `sourceHash`
  is silent. Both deliberate: refusing would strand a reader over an upstream
  typo, and every `grafts.json` written before hashes existed has none.
- `hydrate`, `ui` and `modules` have no test coverage. `exportDiff` now does,
  through a stub, and the same approach would cover the rest if it earns it.
