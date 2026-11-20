// cyrb53-style 64-bit hash. Must stay identical to server/hash.ts: the server
// compares these hashes to tell real conflicts from identical edits.
export function hashBytes(bytes: Uint8Array): string {
  let h1 = 0xdeadbeef ^ bytes.length;
  let h2 = 0x41c6ce57 ^ bytes.length;
  for (let i = 0; i < bytes.length; i++) {
    const c = bytes[i];
    h1 = Math.imul(h1 ^ c, 2654435761);
    h2 = Math.imul(h2 ^ c, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (h2 >>> 0).toString(16).padStart(8, '0') + (h1 >>> 0).toString(16).padStart(8, '0');
}

const encoder = new TextEncoder();
export const hashText = (text: string) => hashBytes(encoder.encode(text));
export const hashBlob = async (blob: Blob) => hashBytes(new Uint8Array(await blob.arrayBuffer()));

/** Deterministic pseudo-random number in [0, 1) derived from a string. */
export function seeded(key: string): number {
  return parseInt(hashText(key).slice(0, 8), 16) / 0x100000000;
}
