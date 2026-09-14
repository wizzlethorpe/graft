// Addressing a file in the reader's Foundry data directory.
//
// Foundry can be served under a route prefix, and a path is authored raw while
// a URL needs its segments encoded. Cache-busted because a handler may have
// replaced the file earlier in this same build.

export function dataUrl(path) {
  const encoded = path.split("/").map(encodeURIComponent).join("/");
  const route = foundry.utils?.getRoute?.(`/${encoded}`) ?? `/${encoded}`;
  return `${route}?v=${Date.now()}`;
}
