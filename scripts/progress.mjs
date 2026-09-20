// One progress notification for the length of a build. Every call is a no-op when the notification API is absent.

let bar = null;
let title = "";
let phaseLabel = "";
let done = 0;
let total = 0;

function paint(message) {
  if (!bar) return;
  const counter = total > 0 ? ` ${Math.min(done, total)}/${total}` : "";
  const head = phaseLabel ? `${title}: ${phaseLabel}${counter}` : title;
  // The item in progress counts as half, so the bar never reads 100% while
  // work continues.
  const finished = Math.max(done - 0.5, 0);
  try {
    bar.update({
      pct: total > 0 ? Math.min(finished / total, 1) : 0,
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

/** Close the bar. Idempotent. */
export function end() {
  if (!bar) return;
  try { ui?.notifications?.remove?.(bar); } catch { /* already gone */ }
  bar = null;
  phaseLabel = "";
}
