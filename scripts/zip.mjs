// Reading members out of a zip held in memory. Stored and deflated entries
// only, which covers what publishers produce; zip64 is refused, not half-read.

const END = 0x06054b50;
const CENTRAL = 0x02014b50;
const LOCAL = 0x04034b50;

/** Each member's name to `{ method, compressed, local }`, from the central directory. */
export function centralDirectory(bytes) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  // The end record is the last 22 bytes, pushed back by a comment of up to 64 KB.
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 22 - 0xffff); i--) {
    if (view.getUint32(i, true) === END) { end = i; break; }
  }
  if (end < 0) throw new Error("not a zip: no end-of-central-directory record");
  const count = view.getUint16(end + 10, true);
  let at = view.getUint32(end + 16, true);
  if (at === 0xffffffff || count === 0xffff) throw new Error("zip64 archives are not supported");

  const members = new Map();
  const decoder = new TextDecoder();
  for (let n = 0; n < count; n++) {
    if (view.getUint32(at, true) !== CENTRAL) throw new Error("corrupt zip: bad central directory entry");
    const nameLength = view.getUint16(at + 28, true);
    members.set(decoder.decode(bytes.subarray(at + 46, at + 46 + nameLength)), {
      method: view.getUint16(at + 10, true),
      compressed: view.getUint32(at + 20, true),
      local: view.getUint32(at + 42, true),
    });
    at += 46 + nameLength + view.getUint16(at + 30, true) + view.getUint16(at + 32, true);
  }
  return members;
}

/** One member's bytes, inflated if it was deflated. */
export async function readMember(bytes, member) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(member.local, true) !== LOCAL) throw new Error("corrupt zip: bad local header");
  // The local header's own lengths, which need not match the central directory's.
  const start = member.local + 30
    + view.getUint16(member.local + 26, true) + view.getUint16(member.local + 28, true);
  const data = bytes.subarray(start, start + member.compressed);
  if (member.method === 0) return data;
  if (member.method !== 8) throw new Error(`unsupported zip compression method ${member.method}`);
  const stream = new Blob([data]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
