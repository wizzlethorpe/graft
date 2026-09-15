// Reading members out of a zip, against a real one Python's zipfile wrote.

import { describe, test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import { centralDirectory, readMember } from "../scripts/zip.mjs";

const pack = new Uint8Array(readFileSync(new URL("./fixtures/pack.zip", import.meta.url)));
const text = (bytes) => new TextDecoder().decode(bytes);

describe("centralDirectory", () => {
  test("names every member, past a trailing comment that moves the end record", () => {
    assert.deepEqual([...centralDirectory(pack).keys()].sort(),
      ["maps/deflated.txt", "maps/stored.txt", "tokens/a b.txt"]);
  });

  test("refuses bytes that are not a zip, rather than reading garbage", () => {
    assert.throws(() => centralDirectory(new TextEncoder().encode("not a zip at all, just text")), /not a zip/);
  });

  test("refuses a zip64 archive rather than reading past what it can address", () => {
    const end = new Uint8Array(22);
    const view = new DataView(end.buffer);
    view.setUint32(0, 0x06054b50, true);
    view.setUint32(16, 0xffffffff, true);
    assert.throws(() => centralDirectory(end), /zip64/);
  });
});

describe("readMember", () => {
  test("returns a stored member as it is", async () => {
    const member = centralDirectory(pack).get("maps/stored.txt");
    assert.equal(text(await readMember(pack, member)), "stored bytes");
  });

  test("inflates a deflated member", async () => {
    const member = centralDirectory(pack).get("maps/deflated.txt");
    assert.equal(member.method, 8, "the fixture's member is not actually deflated");
    assert.equal(text(await readMember(pack, member)), "deflated ".repeat(200));
  });

  test("refuses a compression method it cannot inflate", async () => {
    const local = new Uint8Array(30);
    new DataView(local.buffer).setUint32(0, 0x04034b50, true);
    await assert.rejects(() => readMember(local, { method: 12, compressed: 0, local: 0 }), /unsupported zip compression method 12/);
  });

  test("reads a member whose name has a space in it", async () => {
    const member = centralDirectory(pack).get("tokens/a b.txt");
    assert.equal(text(await readMember(pack, member)), "a name with a space");
  });
});
