// Addressing a file in the reader's Foundry data directory.

/**
 * A data path as a URL: segments encoded, under Foundry's route prefix, and
 * cache-busted because a handler may have replaced the file this build.
 */
export function dataUrl(path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  return `${foundry.utils.getRoute(`/${encoded}`)}?v=${Date.now()}`;
}

/** A JSON object read out of the data directory, or null rather than a throw, so a caller can try the next source. */
export async function readDataJson(path) {
  try {
    const res = await fetch(dataUrl(path));
    if (!res.ok) return null;
    const data = await res.json();
    return data && typeof data === "object" && !Array.isArray(data) ? data : null;
  } catch {
    return null;
  }
}
