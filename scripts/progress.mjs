// One progress notification for the length of a build.
//
// A build used to show "Building grafts for X…" and then nothing until it
// finished. With providers that fetch from a network, that is a minute or more
// of a UI that looks frozen, with no way to tell a slow build from a stuck one.
//
// State is module-level rather than threaded through signatures. The code that
// knows *what* is happening (an asset download inside a provider) sits several
// frames below the loop that knows *how far along* it is, and passing a
// reporter through everything in between would cost more than it explains. One
// build runs at a time, which is what makes a singleton honest.
//
// Everything degrades to a no-op: this must not be why a build fails.

let bar = null;
let title = "";
let phaseLabel = "";
let done = 0;
let total = 0;

function paint(message) {
  if (!bar) return;
  const counter = total > 0 ? ` ${Math.min(done, total)}/${total}` : "";
  const head = phaseLabel ? `${title}: ${phaseLabel}${counter}` : title;
  try {
    bar.update({
      pct: total > 0 ? Math.min(done / total, 1) : 0,
      message: message ? `${head} — ${message}` : head,
    });
  } catch {
    // A changed notification API should cost the bar, not the build.
    bar = null;
  }
}

/** Open the bar. Safe when the API is absent. */
export function begin(label) {
  title = label;
  phaseLabel = "";
  done = 0;
  total = 0;
  try {
    const handle = ui?.notifications?.info(label, { progress: true, permanent: true });
    bar = typeof handle?.update === "function" ? handle : null;
  } catch {
    bar = null;
  }
}

/**
 * Start a named phase of `count` items.
 *
 * The bar restarts within each phase rather than pretending to one overall
 * total: fetching assets and writing documents have no shared unit, and a
 * weighted denominator would be a guess presented as a measurement.
 */
export function phase(name, count = 0) {
  phaseLabel = name;
  done = 0;
  total = count;
  paint("");
}

/** Advance one item. `message` names what is being worked on. */
export function step(message) {
  done++;
  paint(message);
}

/** Change the message without advancing, for work nested inside one item. */
export function note(message) {
  paint(message);
}

/** Close the bar. Idempotent. */
export function end() {
  if (!bar) return;
  try { ui?.notifications?.remove?.(bar); } catch { /* already gone */ }
  bar = null;
  phaseLabel = "";
}
