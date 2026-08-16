/**
 * Running inside TaleSpire.
 *
 * The same code is a web page and a Symbiote. This file is the whole of the
 * difference: where the asset list comes from, and what a finished slab does
 * when you click it.
 *
 * On the page the catalog is a file shipped alongside, frozen at whatever was
 * installed when it was generated. Inside the game there is no need to guess —
 * TaleSpire will hand over every pack the player actually owns, so the catalog
 * is built from their own install and a slab can only ever name an asset they
 * have.
 *
 * The API answers failures by returning an object with a ``cause`` rather than
 * by throwing, so every call has to be looked at, not just awaited.
 */

/** Set by the Symbiote build. Absent on the web, so nothing here ever waits. */
export const IS_SYMBIOTE = Boolean(globalThis.SLABFORGE_SYMBIOTE);

/** What each documented failure of sendSlabToHand means to someone playing. */
const HAND_FAILURES = {
  notInBoard: "Open a board first — there is nowhere to put a slab.",
  clientIsNotInGmMode:
    "Slabs can only be placed in GM mode. Switch to it and click again.",
  invalidSlabString: "TaleSpire would not read that slab.",
  dataOversized: "That slab is too big for TaleSpire. Use smaller sections.",
  spawnFailed: "TaleSpire could not spawn that slab.",
};

/**
 * Wait for the API to be injected.
 *
 * A Symbiote's scripts can run before TaleSpire finishes setting `TS` up, and
 * there is no event for it, so this polls. On the web it returns nothing at
 * once: the flag the build writes is the only thing that says to wait at all,
 * which beats sniffing the user agent for a browser nobody else ships.
 */
export async function connect(timeoutMs = 10000) {
  if (!IS_SYMBIOTE) return null;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const ts = globalThis.TS;
    if (ts && ts.contentPacks && ts.slabs) return ts;
    if (Date.now() > deadline) {
      throw new Error("TaleSpire's API never appeared. Is this Symbiote up to date?");
    }
    await new Promise((resume) => setTimeout(resume, 100));
  }
}

function checked(result, what) {
  if (result && result.cause !== undefined) {
    throw new Error(`TaleSpire refused to ${what}: ${result.cause}`);
  }
  return result;
}

/**
 * Half-extents, in tiles, as (across, deep, tall).
 *
 * A pack index is Unity data, where y is up, while the slab format puts the
 * vertical axis on z — so the footprint comes from x and z and the height from
 * y. The bounds object's own field names are not written down anywhere, hence
 * the list: whichever one is there is used, and `size` is a whole extent rather
 * than a half one, so it is not doubled.
 */
function halfExtent(bounds) {
  const half = bounds?.extent ?? bounds?.m_Extent ?? bounds?.Extent ?? bounds?.extents;
  const whole = bounds?.size ?? bounds?.m_Size;
  const source = half ?? whole;
  if (!source) return null;
  const scale = half ? 1 : 0.5;
  const axis = (value) => (Number.isFinite(value) ? Math.abs(value) * scale : 0.5);
  return [axis(source.x), axis(source.z), axis(source.y)];
}

const round2 = (value) => Math.round(value * 100) / 100;

/**
 * Every tile and prop in every pack the player owns, in catalog shape.
 *
 * Deprecated pieces are left out for the same reason the generator leaves them
 * out: they still resolve, and building a map from them is building it from
 * things TaleSpire has already replaced.
 */
export async function assetsFromPacks(ts) {
  const fragments = checked(await ts.contentPacks.getContentPacks(), "list your packs");
  const packs = checked(await ts.contentPacks.getMoreInfo(fragments), "read your packs");

  const assets = [];
  let reported = false;
  for (const pack of packs) {
    const packName = pack.optionalName || pack.id;
    for (const [kind, elements] of [["Tiles", pack.tiles], ["Props", pack.props]]) {
      for (const raw of elements || []) {
        if (raw.isDeprecated) continue;
        const extent = halfExtent(raw.colliderBoundsBound);
        if (!extent && !reported) {
          // One line, once: if the bounds are shaped differently to what is
          // read here, this is what says so instead of every tile silently
          // becoming a one by one cube.
          reported = true;
          console.warn("Unfamiliar collider bounds", raw.colliderBoundsBound);
        }
        const [across, deep, tall] = extent || [0.5, 0.5, 0.5];
        assets.push({
          id: raw.id,
          name: raw.name,
          kind,
          pack: packName,
          tags: (raw.tags || []).map((tag) => tag.toLowerCase()).sort(),
          footprint: [round2(across * 2), round2(deep * 2)],
          height: round2(tall * 2),
        });
      }
    }
  }
  if (!assets.length) throw new Error("TaleSpire reported no tiles or props.");
  return assets;
}

/** The largest slab this build of TaleSpire will take, or null if it won't say. */
export async function maxSlabBytes(ts) {
  try {
    const bytes = await ts.slabs.getMaxSlabSizeInBytes();
    return Number.isFinite(bytes) && bytes > 0 ? bytes : null;
  } catch {
    return null;
  }
}

/** Put a finished slab in the player's hand, ready to place. */
export async function sendToHand(ts, code) {
  const result = await ts.slabs.sendSlabToHand(code);
  if (result && result.cause !== undefined) {
    throw new Error(HAND_FAILURES[result.cause] || `TaleSpire said: ${result.cause}`);
  }
}
