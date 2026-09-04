# Using it

Every operation has a control in the UI.

- **Installing.** When a graft module has unbuilt entries, graft offers to build on the next world load. It asks once per module and remembers the answer; you can reverse a decline.
- **Rebuilding.** **Build grafts** sits in the header of that module's compendium windows.
- **The report** lists what did not build and why, then anything built with warnings, then a collapsed list of successes as clickable links. A module build's results land in the **Compendium** tab. An entry assembled into an Adventure links to that Adventure.
- **Exporting.** Beside **Copy graft** on a document or folder, **Export graft** writes the same entries to a file. It writes a whole `grafts.json`, format and all, where **Copy graft** writes entries to paste into one.
- **Importing grafts.** **Import grafts** on the Settings tab builds pasted grafts into the world: one entry, a list of entries, or a whole `grafts.json`, typed in or loaded from a file.

Graft reads the pack index to decide whether an entry is built, rather than a stored flag, so it treats both a hand-deleted document and a newly added entry as unbuilt. It unlocks packs for the write and restores them exactly as found, including their folder assignment.

An entry whose document would come out exactly as it already is skips its write. Graft compares against what is in the pack rather than a remembered digest, so a Foundry upgrade that migrates the same input differently and an edit made in the pack by hand both still rebuild. Only the timestamps Foundry rewrites on every save are ignored.
