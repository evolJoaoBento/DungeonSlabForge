/**
 * Encoding placements as a TaleSpire slab.
 *
 * The published V2 spec contradicts itself on the field widths — it calls
 * bits 0-16 an eighteen-bit field — so this follows what a slab TaleSpire
 * actually accepts turned out to contain, read back out of one built by the
 * reference encoder:
 *
 *     bits  0-17   x, in hundredths of a tile
 *     bits 18-35   z, the vertical axis
 *     bits 36-53   y
 *     bits 54-58   rotation, in fifteen-degree steps
 *
 * Note the order: the vertical axis sits in the middle, not at the end.
 */

export const MAGIC = 0xd1ceface;
export const VERSION = 2;

/** TaleSpire refuses anything larger, so there is no point emitting it. */
export const MAX_COMPRESSED_BYTES = 30720;

export const UNITS_PER_TILE = 100;
export const ROTATION_STEP = 15;

export class SlabError extends Error {}

/** A uuid as the sixteen bytes TaleSpire stores, which are little-endian. */
export function uuidBytesLE(id) {
  const hex = id.replace(/-/g, "");
  if (hex.length !== 32 || /[^0-9a-f]/i.test(hex)) {
    throw new SlabError(`${id} is not a uuid.`);
  }
  const bytes = new Uint8Array(16);
  for (let i = 0; i < 16; i++) bytes[i] = parseInt(hex.slice(i * 2, i * 2 + 2), 16);
  // The first three groups are stored least significant byte first; the last
  // two are stored as they read.
  const swapped = new Uint8Array(16);
  swapped.set([bytes[3], bytes[2], bytes[1], bytes[0]], 0);
  swapped.set([bytes[5], bytes[4]], 4);
  swapped.set([bytes[7], bytes[6]], 6);
  swapped.set(bytes.slice(8), 8);
  return swapped;
}

function checkPlacement(p) {
  for (const axis of ["x", "y", "z"]) {
    const value = p[axis];
    if (!Number.isInteger(value) || value < 0 || value > 262143) {
      throw new SlabError(
        `${p.assetId} has ${axis}=${value}; a slab holds whole numbers from 0 ` +
          `to 262143 hundredths of a tile.`
      );
    }
  }
  if (p.degree % ROTATION_STEP || p.degree < 0 || p.degree >= 360) {
    throw new SlabError(
      `${p.assetId} has rotation ${p.degree}; rotation goes in ` +
        `${ROTATION_STEP} degree steps from 0 to 345.`
    );
  }
}

/** One placement as the eight bytes the format packs it into. */
export function packPlacement(p) {
  checkPlacement(p);
  const rot = BigInt(p.degree / ROTATION_STEP);
  return (
    (BigInt(p.x) & 0x3ffffn) |
    ((BigInt(p.z) & 0x3ffffn) << 18n) |
    ((BigInt(p.y) & 0x3ffffn) << 36n) |
    ((rot & 0x1fn) << 54n)
  );
}

/** Placements grouped by asset, keeping the order each first appeared in. */
function groupByAsset(placements) {
  const groups = new Map();
  for (const p of placements) {
    if (!groups.has(p.assetId)) groups.set(p.assetId, []);
    groups.get(p.assetId).push(p);
  }
  return groups;
}

/** The uncompressed slab body. */
export function encodeBody(placements) {
  if (!placements.length) throw new SlabError("Refusing to build an empty slab.");

  const groups = groupByAsset(placements);
  // Two zero bytes close the body. The published spec does not mention them,
  // but a slab built by the reference encoder has them and one built without
  // them decodes an placement short — the reader wants the tail there.
  const size = 10 + groups.size * 20 + placements.length * 8 + 2;
  const buffer = new ArrayBuffer(size);
  const view = new DataView(buffer);
  const bytes = new Uint8Array(buffer);

  view.setUint32(0, MAGIC, true);
  view.setUint16(4, VERSION, true);
  view.setUint16(6, groups.size, true);
  view.setUint16(8, 0, true); // creatures: none, in this version

  let at = 10;
  for (const [assetId, group] of groups) {
    bytes.set(uuidBytesLE(assetId), at);
    view.setUint16(at + 16, group.length, true);
    view.setUint16(at + 18, 0, true); // reserved
    at += 20;
  }
  for (const group of groups.values()) {
    for (const p of group) {
      view.setBigUint64(at, packPlacement(p), true);
      at += 8;
    }
  }
  return bytes;
}

async function gzip(bytes) {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("gzip"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

function toBase64(bytes) {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary);
}

/**
 * The string to paste into TaleSpire, with what it cost to make it.
 */
export async function buildSlab(placements, maxBytes = MAX_COMPRESSED_BYTES) {
  const compressed = await gzip(encodeBody(placements));
  if (compressed.length > maxBytes) {
    throw new SlabError(
      `That slab is ${compressed.length} bytes compressed and TaleSpire takes ` +
        `at most ${maxBytes}. Use smaller sections.`
    );
  }
  return {
    code: toBase64(compressed),
    compressedBytes: compressed.length,
    instanceCount: placements.length,
    assetCount: groupByAsset(placements).size,
  };
}
