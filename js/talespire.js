/**
 * Running inside TaleSpire.
 *
 * The same code is a web page and a Symbiote. This file is the whole of the
 * difference: where the asset list comes from, what a finished slab does when
 * you click it, and where a palette is remembered.
 *
 * On the page the catalog is a file shipped alongside, frozen at whatever was
 * installed when it was generated. Inside the game there is no need to guess —
 * TaleSpire will hand over every pack the player actually owns, so the catalog
 * is built from their own install and a slab can only ever name an asset they
 * have. It will also draw the icon for any of them, which is what makes
 * choosing a tile a matter of looking rather than of reading names.
 *
 * Two things about the API are easy to get wrong, and both were:
 *
 *   - `TS` existing does not mean it can be called. The connection to the game
 *     is started separately and announced by a `hasInitialized` event, which
 *     only arrives if the manifest asks for it. Calling before that answers
 *     with nothing.
 *   - Failures come back as an object with a `cause` rather than as a throw,
 *     so every call has to be looked at, not just awaited.
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
 * The initialisation handshake.
 *
 * The manifest names `onSymbioteStateChange` as the handler for the Symbiote's
 * state events, and TaleSpire looks it up as a global by that name — so it is
 * assigned here rather than exported. This runs while the bundle is still being
 * evaluated, long before any event can be dispatched, so nothing is missed.
 */
let announceReady;
const initialised = new Promise((resolve) => {
  announceReady = resolve;
});
globalThis.onSymbioteStateChange = function onSymbioteStateChange(message) {
  if (message && message.kind === "hasInitialized") announceReady("event");
};

/** True once a call actually answers, whatever the handshake did. */
async function answersCalls(ts) {
  try {
    const who = await ts.clients.whoAmI();
    return !(who && who.cause !== undefined);
  } catch {
    return false;
  }
}

/**
 * Wait for the API to be usable.
 *
 * Belt and braces: the announced event is the documented way, and probing with
 * a harmless call covers a manifest whose subscription did not take. Whichever
 * happens first wins.
 */
export async function connect(timeoutMs = 25000) {
  if (!IS_SYMBIOTE) return null;
  const deadline = Date.now() + timeoutMs;
  let ts = null;
  for (;;) {
    ts = globalThis.TS || globalThis.TaleSpire || null;
    if (ts && ts.contentPacks && ts.slabs) break;
    if (Date.now() > deadline) {
      throw new Error(
        "TaleSpire never injected its API. Check the Symbiote's manifest.json " +
          "still asks for api.version 0.1."
      );
    }
    await new Promise((resume) => setTimeout(resume, 100));
  }

  for (;;) {
    const settled = await Promise.race([
      initialised,
      new Promise((resume) => setTimeout(() => resume(null), 250)),
    ]);
    if (settled) return ts;
    if (await answersCalls(ts)) return ts;
    if (Date.now() > deadline) {
      throw new Error(
        "TaleSpire's API never finished connecting. It answers no calls, and " +
          "no hasInitialized event arrived."
      );
    }
  }
}

function checked(result, what) {
  if (result === undefined || result === null) {
    throw new Error(`TaleSpire returned nothing when asked to ${what}.`);
  }
  if (result.cause !== undefined) {
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
 * the list: whichever one is there is used, and a whole size is halved first.
 */
function halfExtent(bounds) {
  if (!bounds) return null;
  const half = bounds.extent ?? bounds.m_Extent ?? bounds.Extent ?? bounds.extents;
  const whole = bounds.size ?? bounds.m_Size;
  const source = half ?? whole;
  if (!source || typeof source !== "object") return null;
  const scale = half ? 1 : 0.5;
  const axis = (value) => (Number.isFinite(value) ? Math.abs(value) * scale : 0.5);
  return [axis(source.x), axis(source.z), axis(source.y)];
}

const round2 = (value) => Math.round(value * 100) / 100;

/** The lists of placeable things in a pack, whatever they turn out to be called. */
function placeableLists(pack) {
  const found = [];
  for (const [kind, keys] of [
    ["Tiles", ["tiles", "Tiles"]],
    ["Props", ["props", "Props"]],
  ]) {
    const key = keys.find((name) => Array.isArray(pack[name]));
    if (key) found.push([kind, pack[key]]);
  }
  return found;
}

/** Everything the packs said, in a form that can be read back out of the panel. */
export function describePacks(packs) {
  const lines = [`${packs.length} pack(s)`];
  let sample = null;
  for (const pack of packs) {
    const lists = placeableLists(pack);
    const counts = lists.map(([kind, list]) => `${kind.toLowerCase()} ${list.length}`);
    lines.push(
      `· ${pack.optionalName || pack.id || "(unnamed)"}: ` +
        (counts.length ? counts.join(", ") : `no tile or prop list — keys: ${Object.keys(pack).join(", ")}`)
    );
    if (!sample) sample = lists.find(([, list]) => list.length)?.[1][0] ?? null;
  }
  if (sample) {
    lines.push(`first entry: ${JSON.stringify(sample).slice(0, 600)}`);
  }
  return lines.join("\n");
}

/**
 * Every tile and prop in every pack the player owns, in catalog shape.
 *
 * Deprecated pieces are left out for the same reason the generator leaves them
 * out: they still resolve, and building a map from them is building it from
 * things TaleSpire has already replaced. The raw entry is carried along, since
 * it is what the game wants back to draw an icon.
 */
export async function assetsFromPacks(ts) {
  const fragments = checked(await ts.contentPacks.getContentPacks(), "list your packs");
  const packs = checked(await ts.contentPacks.getMoreInfo(fragments), "read your packs");
  if (!Array.isArray(packs)) {
    throw new Error(`TaleSpire described your packs as ${typeof packs}, not a list.`);
  }

  const assets = [];
  for (const pack of packs) {
    const packName = pack.optionalName || pack.id || "unnamed pack";
    for (const [kind, elements] of placeableLists(pack)) {
      for (const raw of elements) {
        if (raw.isDeprecated || raw.IsDeprecated) continue;
        const id = raw.id || raw.Id;
        const name = raw.name || raw.Name;
        if (!id || !name) continue;
        const [across, deep, tall] =
          halfExtent(raw.colliderBoundsBound || raw.ColliderBoundsBound) || [0.5, 0.5, 0.5];
        assets.push({
          id,
          name,
          kind,
          pack: packName,
          tags: (raw.tags || raw.Tags || []).map((tag) => String(tag).toLowerCase()).sort(),
          footprint: [round2(across * 2), round2(deep * 2)],
          height: round2(tall * 2),
          element: raw,
        });
      }
    }
  }
  if (!assets.length) {
    throw new Error(
      "TaleSpire listed your packs but no tiles or props came out of them."
    );
  }
  return { assets, packs };
}

/** The game's own icon for an asset, or null where there is no game to ask. */
export async function thumbnailFor(ts, asset, size = 64) {
  if (!ts || !asset || !asset.element) return null;
  try {
    const element = await ts.contentPacks.createThumbnailElementForBoardObject(
      asset.element,
      size
    );
    return element || null;
  } catch {
    return null;
  }
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

/**
 * Where a saved palette lives.
 *
 * TaleSpire gives a Symbiote a blob of its own; a browser has localStorage.
 * Either way it is one string, so the same code writes both.
 */
const STORE_KEY = "dungeonslabforge:palettes";

export async function loadSaved(ts) {
  try {
    const text = ts
      ? await ts.localStorage.global.getBlob()
      : globalThis.localStorage?.getItem(STORE_KEY);
    if (!text || typeof text !== "string") return {};
    const saved = JSON.parse(text);
    return saved && typeof saved === "object" ? saved : {};
  } catch {
    return {};
  }
}

export async function save(ts, saved) {
  const text = JSON.stringify(saved);
  if (ts) await ts.localStorage.global.setBlob(text);
  else globalThis.localStorage?.setItem(STORE_KEY, text);
}
