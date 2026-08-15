/**
 * Where the map's squares are: how big they are, and where they start.
 *
 * A plan is derived from the tile count rather than from the pitch directly,
 * so the cells always tile the map exactly and the last row and column reach
 * the edge instead of stopping just short of it. "The map" means the picture
 * from the pivot on — what lies before the pivot is margin.
 */

export const MAX_SECTION_TILES = 100;

/** Below the floor is JPEG blocking; above the ceiling is a map of a few cells. */
const MIN_PITCH = 16;
const MAX_PITCH = 400;

export class GridPlan {
  constructor({ imageW, imageH, pxPerSquare, sectionTiles, originX = 0, originY = 0 }) {
    if (pxPerSquare <= 0) throw new Error("Pixels per square must be more than zero.");
    if (sectionTiles <= 0) throw new Error("A section is at least one tile.");
    if (sectionTiles > MAX_SECTION_TILES) {
      throw new Error(
        `A section may be at most ${MAX_SECTION_TILES} tiles per axis; slab ` +
          `coordinates cannot reach further.`
      );
    }
    originX = Math.max(0, Math.round(originX));
    originY = Math.max(0, Math.round(originY));
    if (originX >= imageW || originY >= imageH) {
      throw new Error("The grid cannot start past the end of the picture.");
    }

    Object.assign(this, { imageW, imageH, pxPerSquare, sectionTiles, originX, originY });
    // Rounding: a map measuring 11.43 squares was drawn as 11, and the
    // remainder is margin.
    this.tilesW = Math.max(1, Math.round((imageW - originX) / pxPerSquare));
    this.tilesH = Math.max(1, Math.round((imageH - originY) / pxPerSquare));

    this.sections = [];
    for (let row = 0; row < Math.ceil(this.tilesH / sectionTiles); row++) {
      for (let col = 0; col < Math.ceil(this.tilesW / sectionTiles); col++) {
        this.sections.push({
          key: `${col},${row}`,
          col,
          row,
          x0: col * sectionTiles,
          y0: row * sectionTiles,
          width: Math.min(sectionTiles, this.tilesW - col * sectionTiles),
          height: Math.min(sectionTiles, this.tilesH - row * sectionTiles),
        });
      }
    }
  }

  /** The picture pixels one cell covers. */
  cellRect(x, y) {
    const spanW = this.imageW - this.originX;
    const spanH = this.imageH - this.originY;
    return {
      left: this.originX + Math.round((x * spanW) / this.tilesW),
      top: this.originY + Math.round((y * spanH) / this.tilesH),
      right: this.originX + Math.round(((x + 1) * spanW) / this.tilesW),
      bottom: this.originY + Math.round(((y + 1) * spanH) / this.tilesH),
    };
  }
}

/**
 * The pitch of a drawn grid and where it starts, or null if there is none.
 *
 * Measured on edge strength rather than brightness. A stone texture repeating
 * every 24 pixels dominates the brightness of a real battlemap and drowns out
 * a grid line drawn every 100; in the edge profile the grid lines are the only
 * thing that repeats cleanly right across the picture.
 */
export function detectGrid(imageData) {
  const { width, height, data } = imageData;
  const grey = new Float64Array(width * height);
  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    grey[p] = (data[i] + data[i + 1] + data[i + 2]) / 3;
  }

  const across = new Float64Array(width - 1);
  const down = new Float64Array(height - 1);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width - 1; x++) {
      across[x] += Math.abs(grey[y * width + x + 1] - grey[y * width + x]) / height;
    }
  }
  for (let y = 0; y < height - 1; y++) {
    for (let x = 0; x < width; x++) {
      down[y] += Math.abs(grey[(y + 1) * width + x] - grey[y * width + x]) / width;
    }
  }

  const horizontal = dominantPeriod(across);
  const vertical = dominantPeriod(down);
  if (horizontal === null || vertical === null) return null;
  // A single strong periodicity is more likely a texture than a grid, so the
  // two axes have to agree.
  if (Math.abs(horizontal - vertical) > Math.max(1, 0.05 * Math.max(horizontal, vertical))) {
    return null;
  }

  const pitch = Math.round(((horizontal + vertical) / 2) * 10) / 10;
  return { pitch, originX: phaseOf(across, pitch), originY: phaseOf(down, pitch) };
}

/**
 * The repeat length of a profile, by autocorrelation.
 *
 * Not a spectral peak: a one-pixel grid line is a comb whose harmonics can
 * each outweigh the fundamental, and picking the strongest bin returns a sixth
 * of the true pitch. Autocorrelation peaks at every multiple instead, so the
 * smallest strong lag is the answer.
 */
function dominantPeriod(profile) {
  const mean = profile.reduce((a, b) => a + b, 0) / profile.length;
  const centred = Array.from(profile, (v) => v - mean);
  if (!centred.some((v) => v !== 0)) return null;

  const limit = Math.min(centred.length - 2, MAX_PITCH);
  if (limit <= MIN_PITCH) return null;

  const zero = centred.reduce((a, v) => a + v * v, 0);
  if (zero <= 0) return null;

  const correlation = new Float64Array(limit + 2);
  for (let lag = 1; lag <= limit + 1; lag++) {
    let sum = 0;
    for (let i = 0; i + lag < centred.length; i++) sum += centred[i] * centred[i + lag];
    correlation[lag] = sum / zero;
  }

  let strongest = 0;
  for (let lag = MIN_PITCH; lag <= limit; lag++) strongest = Math.max(strongest, correlation[lag]);
  // A drawn grid correlates with itself one square over; texture does not.
  if (strongest < 0.2) return null;

  for (let lag = MIN_PITCH; lag <= limit; lag++) {
    const value = correlation[lag];
    if (value >= 0.75 * strongest && value >= correlation[lag - 1] && value >= correlation[lag + 1]) {
      return lag;
    }
  }
  return null;
}

/**
 * Where in a period the lines sit, in pixels from the edge of the picture.
 *
 * The profile folded over the period and summed: a drawn grid piles all of its
 * lines into one bin of that fold, and that bin is where the grid starts.
 */
function phaseOf(profile, pitch) {
  const period = Math.round(pitch);
  if (period <= 0) return 0;
  const usable = Math.floor(profile.length / period) * period;
  if (usable < period) return 0;

  const folded = new Float64Array(period);
  for (let i = 0; i < usable; i++) folded[i % period] += profile[i];

  let best = 0;
  for (let i = 1; i < period; i++) if (folded[i] > folded[best]) best = i;
  // A line drawn at x shows in a difference profile at x-1: a difference is
  // the step onto the line rather than the line itself.
  return (best + 1) % period;
}
