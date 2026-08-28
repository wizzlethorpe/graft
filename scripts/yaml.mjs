// Just enough YAML to put a graft entry on the clipboard.
//
// Not a general emitter. It handles what a patch contains, which is scalars,
// plain objects and arrays of them. Its own file because it is pure, and the
// clipboard is the one part of the authoring loop with no safety net: a patch
// that round-trips perfectly in memory is still useless if what the author
// pastes does not parse.

/** Render a graft entry as YAML. */
export function toYaml(value, indent = 0) {
  const pad = "  ".repeat(indent);
  if (value === null) return "null";
  if (Array.isArray(value)) {
    if (value.length === 0) return "[]";
    return "\n" + value.map((v) => `${pad}- ${inline(v, indent + 1)}`).join("\n");
  }
  if (typeof value === "object") {
    const keys = Object.keys(value);
    if (keys.length === 0) return "{}";
    return (indent === 0 ? "" : "\n") + keys
      .map((k) => {
        const rendered = toYaml(value[k], indent + 1);
        // A nested block already begins with its own newline, so a space after
        // the colon would be trailing whitespace on every structural line.
        return `${pad}${k}:${rendered.startsWith("\n") ? "" : " "}${rendered}`;
      })
      .join("\n");
  }
  return scalar(value);
}

function inline(value, indent) {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const body = toYaml(value, indent).replace(/^\n/, "");
    return body.replace(new RegExp(`^${"  ".repeat(indent)}`), "");
  }
  return scalar(value);
}

function scalar(v) {
  if (typeof v !== "string") return String(v);
  // Quote anything YAML would otherwise read as a number, boolean, null, or a
  // structure. A damage formula like `2d8` is fine bare; `null` is not.
  return /^[\w .,'/()+-]+$/.test(v) && !/^(true|false|null|~|\d+(\.\d+)?)$/i.test(v)
    ? v : JSON.stringify(v);
}
