// Getting bytes onto disk before anything is built. A grafts file's `assets`
// block is keyed by handler, and a handler only places files, never entries.

import { dataUrl, readDataJson } from "./paths.mjs";
import { validRegistration } from "./extend.mjs";
import { centralDirectory, readMember } from "./zip.mjs";
import { t } from "./i18n.mjs";

const HOOK = "graftAssets";

/** Where a file can be fetched from, in the order to try: one URL, or mirrors of the same bytes. */
const sourcesOf = (file) => [file?.source].flat();

const fp = () => foundry.applications.apps.FilePicker.implementation;

/** The record of what this world has placed: destination -> `{ sources, etag }`. */
const RECORD = "graft/placed.json";

/** Every asset handler, `http` first so a module can replace it. A registration that fails goes to `refuse`. */
export function collectHandlers(refuse) {
  const handlers = new Map();
  const register = (h) => {
    try { handlers.set(h.id, validRegistration("asset handler", "place", h)); }
    catch (err) { refuse(err.message); }
  };
  register(httpHandler);
  Hooks.callAll(HOOK, register);
  return handlers;
}

/**
 * Run each handler over its own block. A block with no handler is one report
 * line, since the entries that needed it fail on their own besides.
 */
export async function placeAssets(assets, { onPhase, onFile, redownload, handlers } = {}) {
  const skipped = [];
  const warnings = [];
  const kinds = Object.entries(assets ?? {});
  if (kinds.length === 0) return { skipped, warnings };
  // Another module's broken registration costs that handler, not the build.
  const available = handlers ?? collectHandlers((reason) => skipped.push({ by: "assets", id: "(handler)", reason }));
  for (const [kind, config] of kinds) {
    const handler = available.get(kind);
    if (!handler) {
      skipped.push({ by: kind, id: "(assets)", reason: `no handler for "${kind}" assets is installed` });
      continue;
    }
    try {
      const report = (await handler.place(config, { onPhase, onFile, redownload })) ?? {};
      for (const item of report.skipped ?? []) skipped.push({ by: kind, ...item });
      for (const item of report.warnings ?? []) warnings.push({ by: kind, ...item });
    } catch (err) {
      skipped.push({ by: kind, id: "(assets)", reason: err.message });
    }
  }
  return { skipped, warnings };
}

/**
 * Whether a file has to be fetched. It is current when a source it offers now
 * is one it offered when written and its ETag has not moved; with no record, size decides.
 */
export function needsFetch(file, { present, head, record }) {
  if (!present) return true;
  // A record answers on its own; size never gets to overrule one.
  if (record) {
    const written = record.sources ?? [];
    return !sourcesOf(file).some((s) => written.includes(s)) || !head || record.etag !== head.etag;
  }
  if (head && file.size != null && String(file.size) === head.length) return false;
  return true;
}

/** `{ zip, path }` for a source naming a member of a zip (`pack.zip#dir/a.png`), or null. */
export function zipMember(source) {
  const hash = source.indexOf("#");
  if (hash < 0) return null;
  const zip = source.slice(0, hash);
  const path = source.slice(hash + 1);
  let pathname;
  try { pathname = new URL(zip, "http://relative").pathname; } catch { return null; }
  return path && /\.zip$/i.test(pathname) ? { zip, path: decode(path) } : null;
}

/**
 * Which zips to fetch whole, when at least `threshold` of the files naming one
 * need fetching, and which files go to their own URL. A file with no URL of its own takes its zip.
 */
export function planZips(usable, needed, threshold) {
  const zipsOf = (file) => new Set(sourcesOf(file).map(zipMember).filter(Boolean).map((m) => m.zip));
  const tally = (files) => {
    const counts = new Map();
    for (const file of files) for (const zip of zipsOf(file)) counts.set(zip, (counts.get(zip) ?? 0) + 1);
    return counts;
  };
  const referenced = tally(usable);
  const chosen = new Set(
    [...tally(needed)].filter(([zip, n]) => n / referenced.get(zip) >= threshold).map(([zip]) => zip));

  const zips = new Map();
  const direct = [];
  for (const file of needed) {
    const members = sourcesOf(file).map(zipMember);
    const pick = members.find((m) => m && chosen.has(m.zip))
      ?? (members.every(Boolean) ? members[0] : null);
    if (!pick) { direct.push(file); continue; }
    if (!zips.has(pick.zip)) zips.set(pick.zip, []);
    zips.get(pick.zip).push({ file, path: pick.path });
  }
  return { zips, direct };
}

/** Foundry's upload rejects a generic content type, which hosts and zips both give, so the extension decides. */
function typeFor(path, type = "") {
  const usable = type && type !== "application/octet-stream";
  return usable ? type : CONST.UPLOADABLE_FILE_EXTENSIONS[path.split(".").pop()?.toLowerCase()] ?? "";
}

/** Paths come back from `browse` percent-encoded. */
const decode = (path) => { try { return decodeURIComponent(path); } catch { return path; } };

const dirOf = (path) => path.split("/").slice(0, -1).join("/");

/** The files already in each of `dirs`, as decoded paths, and which of `dirs` exist. */
async function listing(dirs) {
  const present = new Set();
  const found = new Set();
  for (const dir of dirs) {
    try {
      const result = await fp().browse("data", dir);
      found.add(dir);
      for (const path of result?.files ?? []) present.add(decode(path));
    } catch { /* not created yet: nothing is present */ }
  }
  return { present, found };
}

async function head(path) {
  try {
    const res = await fetch(dataUrl(path), { method: "HEAD" });
    if (!res.ok) return null;
    return { length: res.headers.get("content-length"), etag: res.headers.get("etag") };
  } catch {
    return null;
  }
}

const readRecord = async () => (await readDataJson(RECORD)) ?? {};

async function writeRecord(record) {
  await ensureDirectory(dirOf(RECORD));
  await upload(RECORD, JSON.stringify(record), "application/json");
}

async function ensureDirectory(dir) {
  const segments = dir.split("/").filter(Boolean);
  let at = "";
  for (const segment of segments) {
    at = at ? `${at}/${segment}` : segment;
    try { await fp().createDirectory("data", at, {}); }
    catch (err) { if (!/exists|already/i.test(String(err?.message ?? err))) throw err; }
  }
}

/**
 * Run `task` over `items`, `limit` in flight. Capped rather than unbounded
 * because Cloudflare rate-limits per IP, and a few hundred at once trips it.
 */
export async function pool(items, limit, task) {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) await task(items[next++]);
  });
  await Promise.all(workers);
}

const CONCURRENCY = 8;

/** Fetch a zip whole when at least this share of the files naming it need fetching. */
const ZIP_THRESHOLD = 0.5;

/**
 * `{ auth?: { <origin>: <token> }, files: [{ source, destination, size }] }`.
 * `redownload(already, total)` is asked once when files are already on disk; true fetches everything.
 */
export const httpHandler = {
  id: "http",
  async place(config, { onPhase, onFile, redownload } = {}) {
    if (!Array.isArray(config?.files)) {
      return config?.files === undefined
        ? {}
        : { skipped: [{ id: "(files)", reason: "http assets need a files array" }] };
    }
    const files = config.files;
    if (files.length === 0) return {};
    const auth = config.auth ?? {};
    const skipped = [];
    const warnings = [];

    // Before anything reads a destination: one file without one throws out of
    // the whole block and strands every other file.
    const usable = [];
    for (const file of files) {
      const bad = unusable(file);
      if (bad) skipped.push({ id: String(file?.destination ?? "(no destination)"), reason: bad });
      else usable.push(file);
    }

    const dirs = new Set(usable.map((f) => dirOf(f.destination)));
    const { present, found } = await listing(dirs);
    const record = await readRecord();
    // Only what browsing did not find: everything in such a directory is about to be written.
    for (const dir of dirs) if (!found.has(dir)) await ensureDirectory(dir);

    const already = usable.filter((f) => present.has(f.destination)).length;
    const everything = already > 0 && redownload ? await redownload(already, usable.length) : false;

    const needed = everything ? [...usable] : [];
    if (!everything) {
      onPhase?.(t("GRAFT.PhaseAssets"), usable.length);
      await pool(usable, CONCURRENCY, async (file) => {
        const known = present.has(file.destination);
        const meta = known ? await head(file.destination) : null;
        if (needsFetch(file, { present: known, head: meta, record: record[file.destination] })) needed.push(file);
        onFile?.(file.destination.split("/").pop());
      });
    }

    let changed = false;
    const placed = (file, etag) => {
      record[file.destination] = { sources: sourcesOf(file), etag };
      changed = true;
      onFile?.(file.destination.split("/").pop());
    };
    const { zips, direct } = planZips(usable, needed, ZIP_THRESHOLD);
    // What a zip could not supply falls back to the file's own URL, if it has one.
    const reasons = new Map();

    for (const [zip, members] of zips) {
      const name = zip.split("?")[0].split("/").pop();
      onPhase?.(name, members.length);
      let bytes, directory;
      try {
        bytes = new Uint8Array(await (await authorizedFetch(zip, auth)).arrayBuffer());
        directory = centralDirectory(bytes);
      } catch (err) {
        // A warning, not a skip: the files still arrive from their own URLs.
        warnings.push({ id: name, reason: `could not use it (${err.message}); its ${members.length} files came from their own URLs` });
        for (const { file } of members) { reasons.set(file, err.message); direct.push(file); }
        continue;
      }
      const missing = [];
      await pool(members, CONCURRENCY, async ({ file, path }) => {
        const entry = directory.get(path);
        if (!entry) { missing.push(path); reasons.set(file, `${zip} holds no ${path}`); direct.push(file); return; }
        try {
          placed(file, await upload(file.destination, await readMember(bytes, entry), typeFor(file.destination)));
        } catch (err) {
          reasons.set(file, err.message); direct.push(file);
        }
      });
      if (missing.length > 0) {
        warnings.push({ id: name, reason: `holds none of ${missing.length} files it was named for; they came from their own URLs` });
      }
    }

    if (direct.length > 0) onPhase?.(t("GRAFT.PhaseAssets"), direct.length);
    await pool(direct, CONCURRENCY, async (file) => {
      const urls = sourcesOf(file).filter((s) => !zipMember(s));
      for (const url of urls) {
        try {
          const res = await authorizedFetch(url, auth);
          const blob = await res.blob();
          placed(file, await upload(file.destination, blob, typeFor(file.destination, blob.type)));
          return;
        } catch (err) {
          reasons.set(file, err.message);
        }
      }
      skipped.push({ id: file.destination, reason: reasons.get(file) ?? "no source it could fetch" });
    });

    if (changed) {
      try { await writeRecord(record); }
      catch (err) {
        warnings.push({ id: RECORD, reason: `could not be written (${err.message}); the next build may fetch these files again` });
      }
    }
    return { skipped, warnings };
  },
};

/**
 * Why a file cannot be placed, or null. Its destination comes from a pasted file
 * and becomes an upload path, so it has to stay inside the data directory.
 */
export function unusable(file) {
  const sources = sourcesOf(file);
  if (sources.length === 0 || !sources.every((s) => typeof s === "string" && s)) return "no source to fetch from";
  const destination = file.destination;
  if (typeof destination !== "string" || !destination) return "no destination to write to";
  if (destination.startsWith("/") || /^[a-z]+:/i.test(destination)) return `destination "${destination}" is not a relative path`;
  if (destination.split("/").includes("..")) return `destination "${destination}" climbs out of the data directory`;
  return null;
}

/** A response for `url`, with the bearer its origin is owed. */
async function authorizedFetch(url, auth) {
  const headers = {};
  let origin = null;
  try { origin = new URL(url).origin; } catch { /* relative or malformed */ }
  const sent = Boolean(origin && auth[origin]);
  if (sent) headers.Authorization = `Bearer ${auth[origin]}`;
  const res = await fetch(url, { headers });
  if (res.status === 401 || res.status === 403) {
    // Only a token that was actually sent can have expired.
    throw new Error(sent
      ? `${res.status} from ${origin}; the token in this grafts file has expired, download it again`
      : `${res.status} fetching ${url}; this grafts file carries no token for ${origin ?? "that origin"}`);
  }
  if (!res.ok) throw new Error(`${res.status} fetching ${url}`);
  return res;
}

/** Write `data` to `destination`, returning the ETag it landed with. */
async function upload(destination, data, type) {
  const name = destination.split("/").pop();
  const result = await fp().upload("data", dirOf(destination), new File([data], name, { type }), {}, { notify: false });
  if (result?.status === "error") throw new Error(result?.message ?? "upload rejected");
  return (await head(destination))?.etag ?? null;
}
