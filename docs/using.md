# Using it

Every operation is available from the UI.

- **Installing.** When a graft module has unbuilt entries, graft offers to build on the next world load. It asks once per module and remembers the answer; declining can be reversed.
- **Rebuilding.** **Build grafts** sits in the header of that module's compendium windows.
- **The report** lists what was not built and why, then anything built with warnings, then a collapsed list of successes as clickable links. Results land in the **Compendium** tab.
- **Exporting.** Beside **Copy graft** on a document or folder, **Export graft** writes the same entries to a file. Always a list, even for one document, because that is the shape a `grafts.json` takes.
- **Building a file.** **Build from file** on the Compendium tab takes a `grafts.json` somebody sent you and builds it into world compendiums, one per document type, filed together under a name you give. Pre-build transforms run first with `"world"` as the module id, so a file naming content another module fetches builds when you have that module installed. Nothing is tracked afterwards: there is no manifest to compare against, so this is an import rather than a subscription.

Whether an entry is built is read from the pack index, not from a stored flag, so both a hand-deleted document and a newly shipped entry are detected as unbuilt. Packs are unlocked for the write and restored exactly as found, including their folder assignment.

An entry whose document would come out exactly as it already is skips its write. Compared against what is in the pack rather than against a remembered digest, so a Foundry upgrade that migrates the same input differently, and an edit made in the pack by hand, both still rebuild. Only the timestamps Foundry rewrites on every save are ignored.
