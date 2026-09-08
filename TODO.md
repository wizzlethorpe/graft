# TODO

Short, and meant to stay short. Anything settled belongs in the README instead.

## Known limits

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
- A document in an ordinary pack that grafts onto a sibling inside an
  Adventure is written during the build; the Adventure is written after it. If
  the Adventure write then fails, the dependent already exists, recording an
  origin nothing resolves. Writing each Adventure as soon as its last member is
  prepared would close it; not done, since it needs a Foundry-side rejection of
  a whole Adventure to matter.
- An embedded source in the adventure form still travels whole, and the build
  writes a record nothing reads. `recordSource` stamps `flags.graft.origin` on
  the member, matching what it does for a top-level source, but
  `embeddedSources` on the export side reads only `_stats.compendiumSource` and
  `originOf` is only ever asked about the root, so **Copy graft** finds no
  origin and ships the body. `adventureSourceUuid` already rebuilds the UUID
  from an origin and a document type; what is missing is the type for an
  embedded container key (`effects`, `pages`), which `ADVENTURE_FIELDS` does not
  cover. Reachable whenever a document inside any installed Adventure is named
  as an embedded source.
- A nested sourced entry reusing an `_id` its outer source already carries comes
  back with the fields that source supplied nulled out. The member has a prior,
  so it diffs as a delta, but `whole` was set for the entire subtree, so
  `referenceSources` references the delta and diffs it against the full inner
  source. Reachable only when the outer source's copy already carries the fields
  the inner one contributes. Building it back re-supplies them from the outer
  source, so the result is a fat patch rather than a wrong document, until the
  day the outer source drops that member. Scoping `isWhole` to each reference is
  worse: the member stops being referenced and its body travels instead. Pinned
  in `test/roundtrip.test.mjs`.
- Upgrading past 0.11.0 can raise one false drift warning. Dropping an empty
  `flags` from a stripped source changed what `project` hashes, so an entry
  whose patch touches `flags` against a source with no flags of its own no
  longer matches the `sourceHash` an older graft recorded. Measured at 2 entries
  in 444 across the vaults in this workspace. **Copy graft** on the entry
  refreshes the hash.
- `ui` has no test coverage. `hydrate` and `modules` are covered through stubs
  where a decision lives there; `exportDiff` the same way.

## Wanted

- Companion modules for fetched content live in their own repos:
  [graft-moulinette](https://github.com/wizzlethorpe/graft-moulinette) exists,
  its design and limits in its own README and TODO.
- An `fa-nexus` companion module, same shape: paths under the world-configured
  `cloudDownloadDirAssets`/`cloudDownloadDirTokens` roots are FA's own catalog
  tree, resolvable through the exported `NexusContentService` and
  `NexusDownloadManager`. Deferred: Nexus users typically may redistribute the
  art anyway. Never treat `__generated/`, `exports/` or `masks/` as catalog
  content; the flattened map a scene actually uses exists only on the machine
  that made it.
