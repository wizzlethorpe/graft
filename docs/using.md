# Using it

Every operation has a control in the UI.

- **Installing.** When a graft module has unbuilt entries, graft offers to build on the next world load. It asks once per module and remembers the answer; you can reverse a decline.
- **Rebuilding.** **Build grafts** sits in the header of that module's compendium windows.
- **The report** lists what did not build and why, then anything built with warnings, then a collapsed list of successes as clickable links. A module build's results land in the **Compendium** tab. An entry assembled into an Adventure links to that Adventure.
- **Exporting.** Beside **Copy graft** on a document or folder, **Export graft** writes the same entries to a file. Both produce a whole `grafts.json`; Export saves it, Copy puts it on the clipboard.
- **Importing grafts.** **Import grafts** on the Settings tab builds a whole `grafts.json` into the world, typed in or loaded from a file. Files its `assets` block names are fetched first. An entry landing on a document already in the world that no import wrote is refused unless you agree to replace it, asked once for the whole import and listed in the report.

Graft reads the pack index to decide whether an entry is built, rather than a stored flag, so it treats both a hand-deleted document and a newly added entry as unbuilt. It unlocks packs for the write and restores them exactly as found, including their folder assignment.

An entry whose document would come out exactly as it already is skips its write. Graft compares against what is in the pack rather than a remembered digest, so a Foundry upgrade that migrates the same input differently and an edit made in the pack by hand both still rebuild. What it ignores is what Foundry writes rather than the graft: the `_stats` bookkeeping, and the differences its HTML sanitiser makes on the way in. A document Foundry last wrote under an older generation is rebuilt anyway, since rebuilding is what migrates it.
