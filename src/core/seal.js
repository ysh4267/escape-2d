// =========================================================
// sealed containers
//
// The sound pack and the model packs are shipped the same way: a magic, a
// salt, an IV, then AES-256-GCM over a raw-deflated payload, the key derived
// with PBKDF2 from the passphrase the page carries (SEALED_KEY in audio.js).
// audio.js has its own copy of this for the sound pack; this is the same
// recipe for anything else, returning the inflated payload split into its
// JSON header and binary body:
//
//   payload = u32 LE header length | header JSON | blobs
// =========================================================

import { SEALED_KEY } from './audio.js';

const SALT_LEN = 16, IV_LEN = 12, ROUNDS = 200000;
let keyPromise = null;
const keys = new Map();

async function keyFor(salt) {
  const id = Array.from(salt).join(',');
  if (keys.has(id)) return keys.get(id);
  if (!keyPromise) {
    keyPromise = crypto.subtle.importKey('raw', new TextEncoder().encode(SEALED_KEY), 'PBKDF2', false, ['deriveKey']);
  }
  const material = await keyPromise;
  const p = crypto.subtle.deriveKey(
    { name: 'PBKDF2', salt, iterations: ROUNDS, hash: 'SHA-256' },
    material, { name: 'AES-GCM', length: 256 }, false, ['decrypt'],
  );
  keys.set(id, p);
  return p;
}

/** can this engine open a sealed pack at all */
export function canUnseal() {
  return !!(globalThis.crypto?.subtle && typeof DecompressionStream === 'function');
}

/**
 * Fetch and open a sealed file. Returns {header, body} (body a Uint8Array of
 * the blob region) or null when the file is missing, the magic is wrong or
 * the key does not fit.
 */
export async function openSealed(url, magic) {
  if (!canUnseal()) return null;
  try {
    const res = await fetch(url);
    if (!res.ok) return null;
    const bytes = new Uint8Array(await res.arrayBuffer());
    if (new TextDecoder().decode(bytes.subarray(0, magic.length)) !== magic) return null;
    let at = magic.length;
    const salt = bytes.subarray(at, (at += SALT_LEN));
    const iv = bytes.subarray(at, (at += IV_LEN));
    const key = await keyFor(salt);
    const squeezed = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, key, bytes.subarray(at));
    const inflated = new Response(new Blob([squeezed]).stream().pipeThrough(new DecompressionStream('deflate-raw')));
    const raw = new Uint8Array(await inflated.arrayBuffer());
    const headLen = new DataView(raw.buffer, raw.byteOffset, 4).getUint32(0, true);
    const header = JSON.parse(new TextDecoder().decode(raw.subarray(4, 4 + headLen)));
    const body = raw.subarray(4 + headLen);
    return { header, body };
  } catch {
    return null;
  }
}
