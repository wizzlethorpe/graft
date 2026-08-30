// Migrating an Adventure's content one document at a time.
//
// Adventure.fromImport whole is a dead end: the server migrates with
// `db.Adventure`, which has no world collection and so no database, and any
// version difference at all crashes it. The nested documents' classes all
// have one, so each content array migrates through its own class and a
// failure costs one warning, not the Adventure.

import test, { describe } from "node:test";
import assert from "node:assert/strict";

import { migrateContent } from "../scripts/hydrate.mjs";

const FIELDS = { scenes: "Scene", actors: "Actor" };

describe("migrateContent", () => {
  test("migrates each document through its own class, keeping ids", async () => {
    const data = {
      name: "Adv",
      scenes: [{ _id: "s1", name: "River" }],
      actors: [{ _id: "a1", name: "Marlo" }],
    };
    const seen = [];
    const { data: out, failures } = await migrateContent(data, FIELDS, async (name, doc) => {
      seen.push([name, doc._id]);
      return { ...doc, migrated: true };
    });
    assert.deepEqual(seen, [["Scene", "s1"], ["Actor", "a1"]]);
    assert.equal(out.scenes[0].migrated, true);
    assert.equal(out.scenes[0]._id, "s1");
    assert.deepEqual(failures, []);
    assert.equal(out.name, "Adv", "non-content fields travel untouched");
  });

  test("keeps a document that cannot migrate as authored, and names it", async () => {
    const data = { scenes: [{ _id: "s1" }, { _id: "s2" }] };
    const { data: out, failures } = await migrateContent(data, FIELDS, async (_n, doc) => {
      if (doc._id === "s1") throw new Error("no database");
      return { ...doc, migrated: true };
    });
    assert.deepEqual(out.scenes[0], { _id: "s1" }, "as authored, not dropped");
    assert.equal(out.scenes[1].migrated, true, "one failure does not stop the rest");
    assert.deepEqual(failures, [{ field: "scenes", _id: "s1", message: "no database" }]);
  });

  test("leaves absent and empty fields alone", async () => {
    const { data: out } = await migrateContent({ scenes: [] }, FIELDS, async () => {
      throw new Error("should not be called");
    });
    assert.deepEqual(out, { scenes: [] });
    assert.equal("actors" in out, false);
  });

  test("does not mutate what it was given", async () => {
    const data = { scenes: [{ _id: "s1" }] };
    await migrateContent(data, FIELDS, async (_n, doc) => ({ ...doc, migrated: true }));
    assert.deepEqual(data.scenes[0], { _id: "s1" });
  });
});
