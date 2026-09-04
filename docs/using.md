# Using it

Every operation has a control in the UI.

- **Installing.** When a graft module has unbuilt entries, graft offers to build on the next world load. It asks once per module and remembers the answer; you can reverse a decline.
- **Rebuilding.** **Build grafts** sits in the header of that module's compendium windows.
- **The report** lists what did not build and why, then anything built with warnings, then a collapsed list of successes as clickable links. Results land in the **Compendium** tab. An entry assembled into an Adventure links to that Adventure, since it has no document of its own to open.
- **Exporting.** Beside **Copy graft** on a document or folder, **Export graft** writes the same entries to a file. It writes a whole `grafts.json`, format and all, where **Copy graft** writes entries to paste into one.
- **Building a file.** **Build from file** on the Compendium tab takes a `grafts.json` somebody sent you and builds it into world compendiums, one per document type, filed together under a name you give. Pre-build transforms run first with `"world"` as the module id, so a file naming content another module fetches builds when you have that module installed. Graft tracks nothing afterwards: there is no manifest to compare against, so this is an import rather than a subscription.

Graft reads the pack index to decide whether an entry is built, rather than a stored flag, so it treats both a hand-deleted document and a newly added entry as unbuilt. It unlocks packs for the write and restores them exactly as found, including their folder assignment.

An entry whose document would come out exactly as it already is skips its write. Graft compares against what is in the pack rather than a remembered digest, so a Foundry upgrade that migrates the same input differently and an edit made in the pack by hand both still rebuild. Only the timestamps Foundry rewrites on every save are ignored.
