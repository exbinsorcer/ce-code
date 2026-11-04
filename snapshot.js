// Saves the finished map of the book so it can open at once, without reading every page again.
// It holds words from the book, so it is only ever kept on your own devices, never in Git or on a hosted page.
const VERSION = 2;

const pack = (_, value) => {
  if (value instanceof Map) return { $m: [...value] };
  if (value instanceof Set) return { $s: [...value] };
  return value;
};
const unpack = (_, value) => {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if ('$m' in value) return new Map(value.$m);
    if ('$s' in value) return new Set(value.$s);
  }
  return value;
};

export function packBook(index, map) {
  return JSON.stringify({ version: VERSION, index, map }, pack);
}

// Returns null when the saved map came from an older build, so the book is read from its pages instead.
export function unpackBook(text) {
  try {
    const data = JSON.parse(text, unpack);
    return data?.version === VERSION && data.index && data.map ? { index: data.index, map: data.map } : null;
  } catch {
    return null;
  }
}
