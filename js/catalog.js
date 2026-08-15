/**
 * The TaleSpire asset catalog, read from the packs the user actually has.
 *
 * Nothing here is shipped with the page. A pack index is Bouncyrock's data and
 * which packs exist differs from one install to the next, so the page asks for
 * the index.json files once and keeps what it parsed in local storage. Nothing
 * is uploaded anywhere: the files are read in the browser.
 *
 * Note the axis mismatch: a pack index is Unity data, where y is up, while the
 * slab format puts the vertical axis on z. The conversion happens once, here.
 */

const KINDS = ["Tiles", "Props"];
const STORE_KEY = "slabforge.catalog.v1";

/** Words marking a piece cut for one position in a run rather than for filling
 *  it. Laid down as the whole wall, a corner gives every room the same notched
 *  edge and no rotation can rescue it. */
const POSITION_WORDS = new Set([
  "corner", "corners", "end", "ends", "cap", "diag", "diagonal", "filler",
  "half", "junction", "tjunction", "inner", "outer", "edge", "strip",
]);

export class UnresolvedAsset extends Error {}

const words = (text) => new Set((text.toLowerCase().match(/\w+/g) || []));

export class Catalog {
  constructor(assets) {
    this.assets = assets.slice().sort((a, b) =>
      a.name.toLowerCase().localeCompare(b.name.toLowerCase()) || a.id.localeCompare(b.id)
    );
    this.byId = new Map(this.assets.map((a) => [a.id.toLowerCase(), a]));
  }

  static fromIndexes(parsed) {
    const assets = [];
    for (const { pack, data } of parsed) {
      for (const kind of KINDS) {
        for (const raw of data[kind] || []) {
          if (raw.IsDeprecated) continue;
          const extent = raw.ColliderBoundsBound?.m_Extent || { x: 0.5, y: 0.5, z: 0.5 };
          assets.push({
            id: raw.Id,
            name: raw.Name,
            kind,
            pack,
            tags: (raw.Tags || []).map((t) => t.toLowerCase()),
            footprint: [
              Math.round(extent.x * 2 * 100) / 100,
              Math.round(extent.z * 2 * 100) / 100,
            ],
            height: Math.round(extent.y * 2 * 100) / 100,
          });
        }
      }
    }
    return new Catalog(assets);
  }

  static fromStorage() {
    try {
      const held = localStorage.getItem(STORE_KEY);
      if (!held) return null;
      const assets = JSON.parse(held);
      return assets.length ? new Catalog(assets) : null;
    } catch (_) {
      return null;
    }
  }

  remember() {
    try {
      localStorage.setItem(STORE_KEY, JSON.stringify(this.assets));
      return true;
    } catch (_) {
      return false; // too big for the quota; the catalog still works this visit
    }
  }

  static forget() {
    localStorage.removeItem(STORE_KEY);
  }

  query({ name = null, kind = null, footprint = null } = {}) {
    const wantedName = name ? name.toLowerCase() : null;
    return this.assets.filter((asset) => {
      if (wantedName !== null && asset.name.toLowerCase() !== wantedName) return false;
      if (kind !== null && asset.kind !== kind) return false;
      if (footprint && (asset.footprint[0] !== footprint[0] || asset.footprint[1] !== footprint[1]))
        return false;
      return true;
    });
  }

  /**
   * Pick exactly one asset, the same one every time.
   *
   * With a keyword search the pick is a ranking rather than a filter, and the
   * ranking is the whole quality of a theme written in words: a phrase like
   * "stone dungeon tile" matches hundreds of assets, so what decides between
   * them decides what the map is built from.
   */
  resolve(spec) {
    const matches = this.query(spec);
    if (!matches.length) throw new UnresolvedAsset(describe(spec));

    if (spec.search) {
      const wanted = words(spec.search);
      if (wanted.size) {
        const scored = matches
          .map((asset) => ({ asset, score: searchScore(asset, wanted) }))
          .filter((entry) => entry.score > 0);
        if (!scored.length) throw new UnresolvedAsset(describe(spec));
        const best = Math.max(...scored.map((e) => e.score));
        const tied = scored.filter((e) => e.score === best).map((e) => e.asset);
        return tied.sort((a, b) => comparePlainness(a, b, wanted))[0];
      }
    }
    return matches.sort((a, b) => a.id.toLowerCase().localeCompare(b.id.toLowerCase()))[0];
  }
}

/**
 * How well an asset answers a set of keywords.
 *
 * Weighted by where the word was found: the name says what an asset IS, while
 * a tag often says only what it sits near. A word found inside a longer one
 * still counts, at half weight, so "wall" keeps finding "Wallbase".
 */
function searchScore(asset, wanted) {
  const name = asset.name.toLowerCase();
  const nameWords = words(name);
  const tagText = asset.tags.join(" ");
  let total = 0;
  for (const word of wanted) {
    if (nameWords.has(word)) total += 4;
    else if (name.includes(word)) total += 2;
    else if (tagText.includes(word)) total += 1;
  }
  return total;
}

/**
 * The tie-break: the plainest asset of those that scored the same.
 *
 * Keyword ties run to hundreds, so this decides most searches. Plainest means
 * something that fits a single cell, then something that covers the cell it is
 * in, then not a piece cut for one position, then the fewest extra words.
 *
 * Fitting is not being square: a wall tile is half a cell deep because it
 * stands on the cell's edge, so a rule wanting exactly 1x1 hands every wall to
 * whichever corner block happens to be a cube.
 */
function comparePlainness(a, b, wanted) {
  const key = (asset) => {
    const longest = Math.max(asset.footprint[0], asset.footprint[1]);
    const tile = asset.kind === "Tiles";
    const unasked = [...words(asset.name)].filter(
      (w) => POSITION_WORDS.has(w) && !wanted.has(w)
    ).length;
    return [
      tile ? (longest <= 1 ? 0 : 1) : 0,
      tile ? (longest === 1 ? 0 : 1) : 0,
      unasked,
      words(asset.name).size,
      asset.name.length,
      asset.id.toLowerCase(),
    ];
  };
  const left = key(a), right = key(b);
  for (let i = 0; i < left.length; i++) {
    if (left[i] < right[i]) return -1;
    if (left[i] > right[i]) return 1;
  }
  return 0;
}

function describe(spec) {
  return `No asset matches ${JSON.stringify(spec)}`;
}

/** Parse the index.json files the user picked. */
export async function readIndexFiles(files) {
  const parsed = [];
  for (const file of files) {
    if (!file.name.toLowerCase().endsWith(".json")) continue;
    const text = await file.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch (_) {
      continue;
    }
    if (!data.Tiles && !data.Props) continue;
    // The pack's own name if it gives one, otherwise the folder it came from.
    const pack = data.Name || file.webkitRelativePath?.split("/")[1] || file.name;
    parsed.push({ pack, data });
  }
  if (!parsed.length) {
    throw new Error(
      "None of those files was a TaleSpire pack index. Look for index.json " +
        "inside the folders under TaleSpire/Taleweaver."
    );
  }
  return Catalog.fromIndexes(parsed);
}
