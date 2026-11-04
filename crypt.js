// Locks and unlocks the book. The password is never saved. Without it, book.enc is scrambled data.
const MAGIC = [0x43, 0x45, 0x43, 0x42, 0x31]; // "CECB1"
const ITERATIONS = 600000;
const HEADER = MAGIC.length + 4 + 16 + 12;

async function makeKey(password, salt, iterations, use) {
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password.normalize('NFKC')), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, { name: 'AES-GCM', length: 256 }, false, [use]);
}

export const MIN_PASSWORD = 12;

// Says what is wrong with a new password, or null when it is fine.
export function passwordProblem(first, second) {
  if ([...first].length < MIN_PASSWORD || !first.trim()) return `Use at least ${MIN_PASSWORD} characters.`;
  if (first !== second) return 'The two passwords do not match.';
  return null;
}

export function isLockedBook(bytes) {
  return bytes.length > HEADER && MAGIC.every((b, i) => bytes[i] === b);
}

export async function lockBook(pdfBytes, password) {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const head = new Uint8Array(HEADER);
  head.set(MAGIC, 0);
  new DataView(head.buffer).setUint32(MAGIC.length, ITERATIONS);
  head.set(salt, MAGIC.length + 4);
  head.set(iv, MAGIC.length + 20);
  const key = await makeKey(password, salt, ITERATIONS, 'encrypt');
  const body = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: head }, key, pdfBytes));
  const out = new Uint8Array(HEADER + body.length);
  out.set(head, 0);
  out.set(body, HEADER);
  return out;
}

// Returns the PDF bytes, or null when the password is wrong or the file was changed.
export async function unlockBook(locked, password) {
  if (!isLockedBook(locked)) return null;
  const view = new DataView(locked.buffer, locked.byteOffset, locked.length);
  const iterations = view.getUint32(MAGIC.length);
  if (iterations < 100000 || iterations > 5000000) return null;
  const head = locked.subarray(0, HEADER);
  const salt = locked.slice(MAGIC.length + 4, MAGIC.length + 20);
  const iv = locked.slice(MAGIC.length + 20, HEADER);
  const key = await makeKey(password, salt, iterations, 'decrypt');
  try {
    return new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv, additionalData: head }, key, locked.subarray(HEADER)));
  } catch {
    return null;
  }
}
