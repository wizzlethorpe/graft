// Asset handlers: who gets each block, and whether a file has to be fetched.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";

import { placeAssets, needsFetch, unusable, httpHandler, planZips, zipMember } from "../scripts/assets.mjs";

describe("placeAssets", () => {
  test("hands each block to the handler its key names", async () => {
    const seen = [];
    const handlers = new Map([
      ["http", { id: "http", place: (config) => { seen.push(["http", config]); } }],
      ["moulinette", { id: "moulinette", place: (config) => { seen.push(["moulinette", config]); } }],
    ]);
    await placeAssets({ http: { files: [1] }, moulinette: { packs: [2] } }, { handlers });
    assert.deepEqual(seen, [["http", { files: [1] }], ["moulinette", { packs: [2] }]]);
  });

  test("reports an unhandled kind once, not once per file", async () => {
    const { skipped } = await placeAssets(
      { moulinette: { files: [1, 2, 3] } }, { handlers: new Map() },
    );
    assert.equal(skipped.length, 1);
    assert.match(skipped[0].reason, /no handler for "moulinette"/);
    assert.equal(skipped[0].by, "moulinette");
  });

  test("a handler throwing is one report line, and the rest still run", async () => {
    let ran = false;
    const handlers = new Map([
      ["http", { id: "http", place: () => { throw new Error("offline"); } }],
      ["moulinette", { id: "moulinette", place: () => { ran = true; } }],
    ]);
    const { skipped } = await placeAssets({ http: {}, moulinette: {} }, { handlers });
    assert.ok(ran, "a later handler did not run after an earlier one threw");
    assert.deepEqual(skipped, [{ by: "http", id: "(assets)", reason: "offline" }]);
  });

  test("a handler's own skips are labelled with the kind", async () => {
    const handlers = new Map([["http", { id: "http", place: () => ({ skipped: [{ id: "a.png", reason: "404" }] }) }]]);
    const { skipped } = await placeAssets({ http: {} }, { handlers });
    assert.deepEqual(skipped, [{ by: "http", id: "a.png", reason: "404" }]);
  });

  test("reports a module's broken handler registration, and places the rest", async () => {
    // Thrown out of the hook, it failed the whole build before any report.
    const saved = globalThis.Hooks;
    let ran = false;
    globalThis.Hooks = { callAll: (_hook, register) => {
      register({ id: "broken" });
      register({ id: "good", place: () => { ran = true; } });
    } };
    try {
      const { skipped } = await placeAssets({ good: {} });
      assert.ok(ran, "a working handler did not run after a broken one registered");
      assert.match(skipped[0].reason, /"broken" needs a place function/);
    } finally {
      globalThis.Hooks = saved;
    }
  });

  test("no assets block is not an error", async () => {
    assert.deepEqual(await placeAssets(undefined, { handlers: new Map() }), { skipped: [], warnings: [] });
  });
});

describe("the http handler's own checks", () => {
  const saved = { fetch: globalThis.fetch, foundry: globalThis.foundry };
  afterEach(() => { globalThis.fetch = saved.fetch; globalThis.foundry = saved.foundry; });

  test("places the other files when one of them cannot be used", async () => {
    // Reading a destination before the check threw out of place() entirely,
    // so one malformed entry left every other file in the block unfetched.
    const fetched = [];
    globalThis.fetch = async (url, init = {}) => {
      if (init.method === "HEAD" || String(url).includes("placed.json")) return { ok: false };
      fetched.push(String(url));
      return { ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/png" }) };
    };
    globalThis.foundry = {
      utils: {},
      applications: { apps: { FilePicker: { implementation: {
        browse: async () => ({ files: [] }),
        createDirectory: async () => {},
        upload: async () => ({ status: "success" }),
      } } } },
    };
    const { skipped } = await httpHandler.place({ files: [
      { source: "https://x/a.png" },
      { source: "https://x/b.png", destination: "d/b.png", size: 1 },
    ] });
    assert.deepEqual(fetched, ["https://x/b.png"]);
    assert.match(skipped[0].reason, /no destination/);
  });

  test("warns when the record of what was placed cannot be written", async () => {
    // Failing quietly, the next build fetched these files again with nothing said.
    globalThis.fetch = async (url, init = {}) => {
      if (init.method === "HEAD" || String(url).includes("placed.json")) return { ok: false };
      return { ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/png" }) };
    };
    globalThis.foundry = {
      utils: {},
      applications: { apps: { FilePicker: { implementation: {
        browse: async () => ({ files: [] }),
        createDirectory: async () => {},
        upload: async (_source, dir) => (dir === "graft" ? { status: "error", message: "disk full" } : { status: "success" }),
      } } } },
    };
    const { skipped, warnings } = await httpHandler.place({ files: [{ source: "https://x/a.png", destination: "d/a.png", size: 1 }] });
    assert.deepEqual(skipped, []);
    assert.match(warnings[0]?.reason ?? "", /could not be written \(disk full\)/);
  });

  test("names a file it cannot use instead of throwing out of the whole block", () => {
    assert.match(unusable({ source: "https://x/a.png" }), /no destination/);
    assert.match(unusable({ destination: "graft/a.png" }), /no source/);
  });

  test("refuses a destination that leaves the data directory", () => {
    // It comes from a pasted file and becomes an upload path.
    assert.match(unusable({ source: "https://x/a", destination: "/etc/passwd" }), /not a relative path/);
    assert.match(unusable({ source: "https://x/a", destination: "https://evil/x" }), /not a relative path/);
    assert.match(unusable({ source: "https://x/a", destination: "graft/../../x" }), /climbs out/);
  });

  test("takes an ordinary destination, whatever prefix the publisher chose", () => {
    // No fixed prefix: a vault writes under its own name, not under graft/.
    assert.equal(unusable({ source: "https://x/a", destination: "vaults/my-vault/a.png" }), null);
  });

  test("reports a files key of the wrong type, and stays quiet when there is none", async () => {
    const loud = await placeAssets({ http: { files: "nope" } }, { handlers: new Map([["http", httpHandler]]) });
    assert.match(loud.skipped[0].reason, /files array/);
    const quiet = await placeAssets({ http: { auth: {} } }, { handlers: new Map([["http", httpHandler]]) });
    assert.deepEqual(quiet.skipped, []);
  });
});

describe("a fetch the server refuses", () => {
  const saved = { fetch: globalThis.fetch, foundry: globalThis.foundry };
  afterEach(() => { globalThis.fetch = saved.fetch; globalThis.foundry = saved.foundry; });

  /** Refuses everything, and records whether a bearer was offered. */
  function refusing(status) {
    const offered = [];
    globalThis.fetch = async (url, init = {}) => {
      if (init.method === "HEAD" || String(url).includes("placed.json")) return { ok: false };
      offered.push(Boolean(init.headers?.Authorization));
      return { ok: false, status };
    };
    globalThis.foundry = {
      utils: {},
      applications: { apps: { FilePicker: { implementation: {
        browse: async () => ({ files: [] }),
        createDirectory: async () => {},
        upload: async () => ({ status: "success" }),
      } } } },
    };
    return offered;
  }

  const file = { source: "https://x/a.png", destination: "d/a.png", size: 1 };

  test("blames the token only when one was sent", async () => {
    refusing(401);
    const { skipped } = await httpHandler.place({ auth: { "https://x": "t" }, files: [file] });
    assert.match(skipped[0].reason, /expired, download it again/);
  });

  test("says a token is missing rather than expired for an origin it has none for", async () => {
    // Sending the reader to re-download a file that was never the problem.
    const offered = refusing(403);
    const { skipped } = await httpHandler.place({ auth: { "https://elsewhere": "t" }, files: [file] });
    assert.deepEqual(offered, [false], "a bearer was sent to an origin it was not for");
    assert.doesNotMatch(skipped[0].reason, /expired/);
    assert.match(skipped[0].reason, /no token for https:\/\/x/);
  });
});

describe("the re-download choice", () => {
  const saved = { fetch: globalThis.fetch, foundry: globalThis.foundry };
  afterEach(() => { globalThis.fetch = saved.fetch; globalThis.foundry = saved.foundry; });

  /**
   * A world where every destination is already on disk and recorded as
   * current, so nothing should be fetched unless the reader asks for it.
   */
  function worldWithEverythingPlaced(files) {
    const fetched = [];
    const record = Object.fromEntries(files.map((f) => [f.destination, { sources: [f.source], etag: "W/1" }]));
    globalThis.fetch = async (url, init = {}) => {
      const path = decodeURIComponent(String(url).split("?")[0]).replace(/^\//, "");
      if (init.method === "HEAD") return { ok: true, headers: new Map([["etag", "W/1"], ["content-length", "1"]]) };
      if (path === "graft/placed.json") return { ok: true, json: async () => record };
      fetched.push(String(url));
      return { ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/png" }) };
    };
    globalThis.foundry = {
      utils: {},
      applications: { apps: { FilePicker: { implementation: {
        browse: async () => ({ files: files.map((f) => f.destination) }),
        createDirectory: async () => {},
        upload: async () => ({ status: "success" }),
      } } } },
    };
    return fetched;
  }

  const files = [
    { source: "https://x/a.png", destination: "d/a.png", size: 1 },
    { source: "https://x/b.png", destination: "d/b.png", size: 1 },
  ];

  test("asks when files are already here, and skips them when told to", async () => {
    const fetched = worldWithEverythingPlaced(files);
    const asked = [];
    await httpHandler.place({ files }, { redownload: async (n, total) => { asked.push([n, total]); return false; } });
    assert.deepEqual(asked, [[2, 2]], "was not asked, or was told the wrong counts");
    assert.deepEqual(fetched, [], "fetched files the reader chose to keep");
  });

  test("fetches everything when told to, whatever the record says", async () => {
    // The record says both are current; the reader overruling it is the point.
    const fetched = worldWithEverythingPlaced(files);
    await httpHandler.place({ files }, { redownload: async () => true });
    assert.deepEqual(fetched.sort(), ["https://x/a.png", "https://x/b.png"]);
  });
});

describe("a zip the handler cannot use", () => {
  const saved = { fetch: globalThis.fetch, foundry: globalThis.foundry };
  afterEach(() => { globalThis.fetch = saved.fetch; globalThis.foundry = saved.foundry; });

  test("says so, and still delivers its files from their own URLs", async () => {
    // Silently falling back made a push that never shipped the zip look
    // identical to one that did.
    const fetched = [];
    globalThis.fetch = async (url, init = {}) => {
      if (init.method === "HEAD") return { ok: false, headers: new Map() };
      const u = String(url);
      if (u.includes("placed.json")) return { ok: false };
      fetched.push(u);
      if (u.includes(".zip")) return { ok: false, status: 404 };
      return { ok: true, status: 200, blob: async () => new Blob(["x"], { type: "image/png" }) };
    };
    globalThis.foundry = {
      utils: {},
      applications: { apps: { FilePicker: { implementation: {
        browse: async () => { throw new Error("no such directory"); },
        createDirectory: async () => {},
        upload: async () => ({ status: "success" }),
      } } } },
    };
    const files = ["a", "b"].map((n) => ({
      source: [`https://x/pack.zip#${n}.png`, `https://x/${n}.png?v=1`], destination: `d/${n}.png`, size: 1,
    }));

    const { skipped, warnings } = await httpHandler.place({ files });
    assert.deepEqual(skipped, [], "a file was lost when it had a URL of its own to fall back on");
    assert.ok(fetched.includes("https://x/a.png?v=1") && fetched.includes("https://x/b.png?v=1"),
      "the fallback URLs were not used");
    assert.equal(warnings.length, 1, "the unusable zip went unreported");
    assert.match(warnings[0].reason, /could not use it .*404.*2 files/);
  });
});

describe("pool", () => {
  test("runs the whole list, and no more than the limit at once", async () => {
    // Every file is a fetch, an upload and a HEAD; serialising them is what
    // made a 361-asset import take minutes.
    const { pool } = await import("../scripts/assets.mjs");
    const items = Array.from({ length: 25 }, (_, i) => i);
    const done = [];
    let live = 0, peak = 0;
    await pool(items, 4, async (i) => {
      live++; peak = Math.max(peak, live);
      await new Promise((r) => setTimeout(r, 1));
      done.push(i); live--;
    });
    assert.equal(done.length, 25, "some items never ran");
    assert.ok(peak > 1, "ran one at a time");
    assert.ok(peak <= 4, `ran ${peak} at once, over the limit`);
  });
});

describe("zipMember", () => {
  test("reads a fragment on a zip as the member inside it", () => {
    assert.deepEqual(zipMember("https://x/pack.zip#maps/a.png"), { zip: "https://x/pack.zip", path: "maps/a.png" });
  });

  test("keeps the zip's own query, which is where its version lives", () => {
    // A fragment never reaches the server, so it cannot collide with ?v=.
    assert.deepEqual(zipMember("https://x/pack.zip?v=2#a.png"), { zip: "https://x/pack.zip?v=2", path: "a.png" });
  });

  test("decodes the member path, so a name with a space finds its entry", () => {
    assert.equal(zipMember("https://x/pack.zip#tokens/a%20b.png").path, "tokens/a b.png");
  });

  test("keeps a stray percent sign in a member name rather than throwing", () => {
    // Thrown, it took the whole http block down with it.
    assert.equal(zipMember("https://x/pack.zip#100%.png").path, "100%.png");
  });

  test("leaves a fragment on anything that is not a zip alone", () => {
    assert.equal(zipMember("https://x/page.html#section"), null);
    assert.equal(zipMember("https://x/a.png"), null);
    assert.equal(zipMember("https://x/pack.zip#"), null, "an empty fragment names no member");
  });
});

describe("planZips", () => {
  const zip = "https://x/pack.zip";
  const file = (n, { direct = true } = {}) => ({
    destination: `d/${n}.png`,
    source: direct ? [`${zip}#${n}.png`, `https://x/${n}.png`] : `${zip}#${n}.png`,
  });
  const ten = Array.from({ length: 10 }, (_, i) => file(i));

  test("takes the zip when most of what it holds is needed, as on a first import", () => {
    const { zips, direct } = planZips(ten, ten, 0.5);
    assert.equal(zips.get(zip)?.length, 10);
    assert.deepEqual(direct, []);
  });

  test("goes to each file's own URL when only a few are, as on a rebuild", () => {
    // Downloading the whole zip for one changed map is the cost this avoids.
    const { zips, direct } = planZips(ten, [ten[3]], 0.5);
    assert.equal(zips.size, 0, "fetched a whole zip for one file");
    assert.deepEqual(direct, [ten[3]]);
  });

  test("still takes the zip for a file with nowhere else to go", () => {
    const only = file("lone", { direct: false });
    const { zips, direct } = planZips([...ten, only], [only], 0.5);
    assert.deepEqual(zips.get(zip)?.map((m) => m.file), [only]);
    assert.deepEqual(direct, []);
  });


  test("sends a file with no zip at all straight to its own URL", () => {
    const plain = { destination: "d/p.png", source: "https://x/p.png" };
    assert.deepEqual(planZips([plain], [plain], 0.5).direct, [plain]);
  });
});

describe("needsFetch", () => {
  const file = { source: "https://v.example/a.png?v=abc", destination: "assets/a.png", size: 100 };
  const head = (length, etag) => ({ length, etag });

  test("fetches what is not on disk", () => {
    assert.equal(needsFetch(file, { present: false, head: null, record: undefined }), true);
  });

  test("skips when the record names this source and the file is untouched", () => {
    assert.equal(needsFetch(file, {
      present: true, head: head("100", 'W/"64-1a"'), record: { sources: [file.source], etag: 'W/"64-1a"' },
    }), false);
  });

  test("fetches when the record names an older source, whatever the file looks like", () => {
    // The URL carries the version, so a different one is different content
    // even at an identical size.
    assert.equal(needsFetch(file, {
      present: true, head: head("100", 'W/"64-1a"'), record: { sources: ["https://v.example/a.png?v=old"], etag: 'W/"64-1a"' },
    }), true);
  });

  test("fetches when the file moved since it was written", () => {
    assert.equal(needsFetch(file, {
      present: true, head: head("100", 'W/"64-99"'), record: { sources: [file.source], etag: 'W/"64-1a"' },
    }), true);
  });

  test("falls back to size when nothing was ever recorded", () => {
    assert.equal(needsFetch(file, { present: true, head: head("100", 'W/"x"'), record: undefined }), false);
    assert.equal(needsFetch(file, { present: true, head: head("999", 'W/"x"'), record: undefined }), true);
  });

  test("fetches when the file states no size, since presence proves nothing", () => {
    const sizeless = { ...file, size: undefined };
    assert.equal(needsFetch(sizeless, { present: true, head: head("100", 'W/"x"'), record: undefined }), true);
  });

  test("skips a file that moved to another zip, since its own URL still carries the same version", () => {
    // Chunk membership shifts when a vault gains a file; the bytes do not.
    const before = ["https://v.example/chunk-a.zip#a.png", "https://v.example/a.png?v=h1"];
    const after = { ...file, source: ["https://v.example/chunk-b.zip#a.png", "https://v.example/a.png?v=h1"] };
    assert.equal(needsFetch(after, {
      present: true, head: head("100", 'W/"x"'), record: { sources: before, etag: 'W/"x"' },
    }), false);
  });

  test("fetches when no source it offers now is one it offered then", () => {
    const before = ["https://v.example/chunk-a.zip#a.png", "https://v.example/a.png?v=h1"];
    const after = { ...file, source: ["https://v.example/chunk-a.zip#a.png?v=2", "https://v.example/a.png?v=h2"] };
    assert.equal(needsFetch(after, {
      present: true, head: head("100", 'W/"x"'), record: { sources: before, etag: 'W/"x"' },
    }), true);
  });

  test("fetches when a HEAD says nothing, rather than trusting a record it cannot confirm", () => {
    assert.equal(needsFetch(file, { present: true, head: null, record: { sources: [file.source], etag: 'W/"x"' } }), true);
  });
});
