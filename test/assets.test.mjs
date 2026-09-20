// Asset handlers: who gets each block, and whether and how a file is placed.

import { describe, test, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { placeAssets, collectAssets, placeFile, needsFetch, unusable, httpHandler, planZips, pool, zipMember } from "../scripts/assets.mjs";

const saved = { fetch: globalThis.fetch, foundry: globalThis.foundry, CONST: globalThis.CONST, Hooks: globalThis.Hooks };
afterEach(() => Object.assign(globalThis, saved));

/**
 * A data directory and a network for the http handler. Returns what the handler
 * did to them: the directories it made and the files it uploaded.
 */
function stubFoundry({ fetch, browse = async () => ({ files: [] }), refuseUpload = () => null }) {
  const did = { directories: [], uploads: [] };
  globalThis.fetch = fetch;
  globalThis.CONST = { UPLOADABLE_FILE_EXTENSIONS: { png: "image/png", txt: "text/plain", json: "application/json" } };
  globalThis.foundry = {
    utils: { getRoute: (path) => path },
    applications: { apps: { FilePicker: { implementation: {
      browse,
      createDirectory: async (_source, path) => { did.directories.push(path); },
      upload: async (_source, dir, file) => {
        const refusal = refuseUpload(dir);
        if (refusal) return { status: "error", message: refusal };
        did.uploads.push({ path: `${dir}/${file.name}`, type: file.type, text: await file.text() });
        return { status: "success" };
      },
    } } } },
  };
  return did;
}

const ok = (body, type = "image/png") => ({ ok: true, status: 200, blob: async () => new Blob([body], { type }) });
const missing = { ok: false, status: 404, headers: new Map() };

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
    // A throw from the hook would fail the whole build before any report.
    let ran = false;
    globalThis.Hooks = { callAll: (_hook, register) => {
      register({ id: "broken" });
      register({ id: "good", place: () => { ran = true; } });
    } };
    const { skipped } = await placeAssets({ good: {} });
    assert.ok(ran, "a working handler did not run after a broken one registered");
    assert.match(skipped[0].reason, /"broken" needs a place function/);
  });

  test("no assets block is not an error", async () => {
    assert.deepEqual(await placeAssets(undefined, { handlers: new Map() }), { skipped: [], warnings: [] });
  });
});

describe("collectAssets", () => {
  const entries = [{ id: "a", patch: { img: "lib/a.png" } }];

  test("keys each handler's block by its id, and asks only a handler that collects", async () => {
    const handlers = new Map([
      ["http", { id: "http", place() {} }],
      ["lib", { id: "lib", place() {}, collect: async (given) => ({ files: given.map((e) => e.patch.img) }) }],
    ]);
    assert.deepEqual(await collectAssets(entries, handlers), { lib: { files: ["lib/a.png"] } });
  });

  test("is nothing when no handler claims anything, so a copy gains no empty block", async () => {
    const handlers = new Map([["lib", { id: "lib", place() {}, collect: () => null }]]);
    assert.equal(await collectAssets(entries, handlers), undefined);
  });

  test("fails the copy when a handler's registration was refused, since its files would be silently missing", async () => {
    globalThis.Hooks = { callAll: (_hook, register) => register({ id: "lib", collect: () => ({ files: [] }) }) };
    await assert.rejects(collectAssets(entries), /asset handler "lib" needs a place function/);
  });

  test("fails the copy when a handler cannot say", async () => {
    const handlers = new Map([["lib", { id: "lib", place() {}, collect: async () => { throw new Error("signed out"); } }]]);
    await assert.rejects(collectAssets(entries, handlers), /signed out/);
  });
});

describe("placeFile", () => {
  test("makes the folders on the way, then writes", async () => {
    const did = stubFoundry({ fetch: async () => ({ ok: false, headers: new Headers() }) });
    await placeFile("graft/lib/12/a.json", "{}", "application/json");
    assert.deepEqual(did.directories, ["graft", "graft/lib", "graft/lib/12"]);
    assert.deepEqual(did.uploads, [{ path: "graft/lib/12/a.json", type: "application/json", text: "{}" }]);
  });

  test("refuses a destination outside the data directory, since a handler's destinations come from a pasted file", async () => {
    const did = stubFoundry({ fetch: async () => ({ ok: false, headers: new Headers() }) });
    await assert.rejects(placeFile("graft/lib/../../worlds/w/a.json", "{}"), /climbs out of the data directory/);
    await assert.rejects(placeFile("/etc/a.json", "{}"), /not a relative path/);
    assert.deepEqual(did, { directories: [], uploads: [] });
  });

  test("types a blob a host served generically by its extension, since Foundry's upload rejects a generic type", async () => {
    const did = stubFoundry({ fetch: async () => ({ ok: false, headers: new Headers() }) });
    await placeFile("graft/lib/12/a.png", new Blob(["x"], { type: "application/octet-stream" }));
    assert.equal(did.uploads[0].type, "image/png");
  });
});

describe("the http handler's own checks", () => {
  test("places the other files when one of them cannot be used", async () => {
    const fetched = [];
    stubFoundry({ fetch: async (url, init = {}) => {
      if (init.method === "HEAD" || String(url).includes("placed.json")) return missing;
      fetched.push(String(url));
      return ok("x");
    } });
    const { skipped } = await httpHandler.place({ files: [
      { source: "https://x/a.png" },
      { source: "https://x/b.png", destination: "d/b.png", size: 1 },
    ] });
    assert.deepEqual(fetched, ["https://x/b.png"]);
    assert.match(skipped[0].reason, /no destination/);
  });

  test("warns when the record of what was placed cannot be written", async () => {
    // Unreported, the next build fetches these files again with nothing said.
    stubFoundry({
      fetch: async (url, init = {}) => (init.method === "HEAD" || String(url).includes("placed.json") ? missing : ok("x")),
      refuseUpload: (dir) => (dir === "graft" ? "disk full" : null),
    });
    const { skipped, warnings } = await httpHandler.place({ files: [{ source: "https://x/a.png", destination: "d/a.png", size: 1 }] });
    assert.deepEqual(skipped, []);
    assert.match(warnings[0]?.reason ?? "", /could not be written \(disk full\)/);
  });

  test("says why a file cannot be used", () => {
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

describe("placing files out of a zip", () => {
  const pack = readFileSync(new URL("./fixtures/pack.zip", import.meta.url));
  const files = [
    ["maps/stored.txt", "d/stored.txt"],
    ["maps/deflated.txt", "d/deflated.txt"],
    ["tokens/a%20b.txt", "t/a b.txt"],
  ].map(([member, destination]) => ({
    source: [`https://x/pack.zip#${member}`, `https://x/${destination}?v=1`],
    destination,
    size: 1,
  }));

  /** Serves the fixture as the zip, and `record` as what an earlier build placed. */
  const network = (record) => async (url, init = {}) => {
    if (init.method === "HEAD") return { ok: true, headers: new Map([["etag", "W/1"], ["content-length", "1"]]) };
    const u = String(url);
    if (u.includes("placed.json")) return record ? { ok: true, json: async () => record } : missing;
    if (u.startsWith("https://x/pack.zip")) {
      return { ok: true, status: 200, arrayBuffer: async () => pack.buffer.slice(pack.byteOffset, pack.byteOffset + pack.byteLength) };
    }
    throw new Error(`fetched ${u}, which the zip should have supplied`);
  };

  test("writes each member where its file says, typed by its destination, and records where it came from", async () => {
    const did = stubFoundry({ fetch: network(null), browse: async () => { throw new Error("no such directory"); } });
    const { skipped, warnings } = await httpHandler.place({ files });
    assert.deepEqual(skipped, []);
    assert.deepEqual(warnings, []);
    const placed = Object.fromEntries(did.uploads.map((u) => [u.path, u]));
    assert.equal(placed["d/stored.txt"]?.text, "stored bytes");
    assert.equal(placed["d/deflated.txt"]?.text, "deflated ".repeat(200));
    assert.equal(placed["t/a b.txt"]?.text, "a name with a space");
    assert.equal(placed["d/stored.txt"]?.type, "text/plain", "a zip member carries no type of its own");
    assert.deepEqual(did.directories.sort(), ["d", "graft", "t"]);
    const record = JSON.parse(placed["graft/placed.json"]?.text ?? "{}");
    assert.deepEqual(record["t/a b.txt"], { sources: files[2].source, etag: "W/1" });
  });

  test("makes no directory that browsing already found, even for a file it writes there", async () => {
    const did = stubFoundry({ fetch: network(null), browse: async () => ({ files: [] }) });
    await httpHandler.place({ files });
    assert.equal(did.uploads.length, 4, "three files and the record");
    assert.deepEqual(did.directories, ["graft"]);
  });

  test("touches nothing on a rebuild where every file is current", async () => {
    const record = Object.fromEntries(files.map((f) => [f.destination, { sources: f.source, etag: "W/1" }]));
    const did = stubFoundry({
      fetch: network(record),
      browse: async (_source, dir) => ({ files: files.filter((f) => f.destination.startsWith(`${dir}/`)).map((f) => f.destination) }),
    });
    await httpHandler.place({ files });
    assert.deepEqual(did.uploads, []);
    assert.deepEqual(did.directories, [], "made directories nothing was about to be written into");
  });
});

describe("a fetch the server refuses", () => {
  /** Refuses everything, and records whether a bearer was offered. */
  function refusing(status) {
    const offered = [];
    stubFoundry({ fetch: async (url, init = {}) => {
      if (init.method === "HEAD" || String(url).includes("placed.json")) return missing;
      offered.push(Boolean(init.headers?.Authorization));
      return { ok: false, status };
    } });
    return offered;
  }

  const file = { source: "https://x/a.png", destination: "d/a.png", size: 1 };

  test("blames the token only when one was sent", async () => {
    refusing(401);
    const { skipped } = await httpHandler.place({ auth: { "https://x": "t" }, files: [file] });
    assert.match(skipped[0].reason, /expired, download it again/);
  });

  test("says a token is missing rather than expired for an origin it has none for", async () => {
    // Blaming the token would send the reader to download a file that was never the problem.
    const offered = refusing(403);
    const { skipped } = await httpHandler.place({ auth: { "https://elsewhere": "t" }, files: [file] });
    assert.deepEqual(offered, [false], "a bearer was sent to an origin it was not for");
    assert.doesNotMatch(skipped[0].reason, /expired/);
    assert.match(skipped[0].reason, /no token for https:\/\/x/);
  });
});

describe("the re-download choice", () => {
  /** Every destination already on disk and recorded as current. */
  function everythingPlaced(files) {
    const fetched = [];
    const record = Object.fromEntries(files.map((f) => [f.destination, { sources: [f.source], etag: "W/1" }]));
    stubFoundry({
      fetch: async (url, init = {}) => {
        if (init.method === "HEAD") return { ok: true, headers: new Map([["etag", "W/1"], ["content-length", "1"]]) };
        if (String(url).includes("placed.json")) return { ok: true, json: async () => record };
        fetched.push(String(url));
        return ok("x");
      },
      browse: async () => ({ files: files.map((f) => f.destination) }),
    });
    return fetched;
  }

  const files = [
    { source: "https://x/a.png", destination: "d/a.png", size: 1 },
    { source: "https://x/b.png", destination: "d/b.png", size: 1 },
  ];

  test("asks when files are already here, and skips them when told to", async () => {
    const fetched = everythingPlaced(files);
    const asked = [];
    await httpHandler.place({ files }, { redownload: async (n, total) => { asked.push([n, total]); return false; } });
    assert.deepEqual(asked, [[2, 2]], "was not asked, or was told the wrong counts");
    assert.deepEqual(fetched, [], "fetched files the reader chose to keep");
  });

  test("fetches everything when told to, whatever the record says", async () => {
    // The record says both are current; the reader overruling it is the point.
    const fetched = everythingPlaced(files);
    await httpHandler.place({ files }, { redownload: async () => true });
    assert.deepEqual(fetched.sort(), ["https://x/a.png", "https://x/b.png"]);
  });
});

describe("a zip the handler cannot use", () => {
  test("says so, and still delivers its files from their own URLs", async () => {
    const fetched = [];
    stubFoundry({
      fetch: async (url, init = {}) => {
        const u = String(url);
        if (init.method === "HEAD" || u.includes("placed.json")) return missing;
        fetched.push(u);
        return u.includes(".zip") ? { ok: false, status: 404 } : ok("x");
      },
      browse: async () => { throw new Error("no such directory"); },
    });
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
    // A throw here would take the whole http block down.
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

  test("fetches when the file changed on disk since it was written", () => {
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
