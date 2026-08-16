/**
 * Themes: the bridge from a label like "wall" to a concrete TaleSpire asset.
 *
 * A theme is data, so adding a look means adding a few lines of JSON rather
 * than touching the pipeline. A theme that half-resolves still works: a missing
 * label degrades to its declared fallback, or to nothing, and says so in its
 * warnings. The one exception is floor, without which there is no map.
 */

import { UnresolvedAsset } from "./catalog.js";

/**
 * The themes, resolved against a catalog.
 *
 * `source` is normally the file to fetch. The Symbiote build passes the specs
 * themselves instead, because a Symbiote's own files are served over a scheme
 * of TaleSpire's making and there is no promise that fetching one works.
 */
export async function loadThemes(catalog, source = "./js/themes.json") {
  const specs = typeof source === "string" ? await (await fetch(source)).json() : source;
  const themes = {};
  for (const [name, spec] of Object.entries(specs)) themes[name] = resolveTheme(name, spec, catalog);
  return themes;
}

export function resolveTheme(name, spec, catalog) {
  const assets = {};
  const sinks = {};
  const queries = {};
  const warnings = [];
  const deferred = {};

  for (const [label, entry] of Object.entries(spec.labels || {})) {
    const query = {
      name: entry.name ?? null,
      kind: entry.kind ?? null,
      search: entry.search ?? null,
      footprint: entry.footprint ?? null,
    };
    queries[label] = query;
    sinks[label] = entry.sink || 0;
    try {
      assets[label] = catalog.resolve(query);
    } catch (error) {
      if (!(error instanceof UnresolvedAsset)) throw error;
      if (entry.fallback) {
        deferred[label] = entry.fallback;
        warnings.push(`${label} matched no asset; falling back to ${entry.fallback}.`);
      } else {
        warnings.push(`${label} matched no asset; those cells stay empty.`);
      }
    }
  }
  for (const [label, fallback] of Object.entries(deferred)) {
    if (assets[fallback]) assets[label] = assets[fallback];
  }
  if (!assets.floor) {
    throw new Error(`Theme ${name} has no usable floor. Are these the right packs?`);
  }

  // The lift is a property of the theme: only labels that resolved can sink the
  // map, or a tile that is never placed lifts the whole build.
  const deepest = Math.max(0, ...Object.keys(assets).map((label) => sinks[label] || 0));

  return {
    name,
    description: spec.description || "",
    wallLayers: spec.wall_layers ?? 1,
    baseZ: deepest * 100,
    assets,
    // What a label may draw from, the primary first. A theme resolves to one
    // piece per label; a person can give it several, and then a floor stops
    // being four hundred copies of the same tile.
    variants: Object.fromEntries(Object.entries(assets).map(([label, a]) => [label, [a]])),
    sinks,
    queries,
    warnings,
    catalog,
    /** Every asset the label's query matched, for the swap dropdown. */
    alternativesFor(label) {
      const query = this.queries[label];
      return query ? this.catalog.query(query) : [];
    },
    /**
     * The theme with one label drawing from a chosen set of pieces.
     *
     * Ids that no longer name anything are dropped rather than refused: they
     * come from a palette saved when another pack was ticked, and losing the
     * one piece that went away is better than losing the whole choice.
     */
    withVariants(label, assetIds) {
      const found = assetIds
        .map((id) => this.catalog.byId.get(String(id).toLowerCase()))
        .filter(Boolean);
      if (!found.length) {
        throw new Error(`None of those assets are in the packs you loaded.`);
      }
      return {
        ...this,
        assets: { ...this.assets, [label]: found[0] },
        variants: { ...this.variants, [label]: found },
      };
    },
  };
}
