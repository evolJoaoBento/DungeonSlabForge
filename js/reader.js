/**
 * Reading a map below the size of a cell.
 *
 * Judging a whole cell at a time is what limits a reader: on these maps a wall
 * is a band about a third of a cell wide drawn along the edge of a floor, so
 * judging by the cell rounds the band up to a whole cell. The room loses a cell
 * of space and the wall comes out twice as thick as it was drawn.
 *
 * So each cell is sampled on a grid of its own, and three things are read off
 * the result: a cell covered in floor is floor whatever runs along its edge; a
 * band of wall tone lying along a boundary is a wall on that boundary; and wall
 * tone thick enough to fill cells is a wall region.
 */

export const SUBCELLS = 8;
export const BACKDROP = 0, FLOOR = 1, WALL = 2, WATER = 3;

/** How the drawing is put together. Told rather than guessed: a sketch on grey
 *  paper and a lit map on a pale backdrop look the same to a threshold. */
export const LIT_ON_DARK = "lit_on_dark";
export const DARK_ON_LIGHT = "dark_on_light";
export const TRANSPARENT = "transparent";
export const STYLES = [LIT_ON_DARK, TRANSPARENT, DARK_ON_LIGHT];

const WALL_TONE_GAP = 25;
const WATER_TINT = 15;
const FLOOR_SHARE = 0.35;
const WALL_FILLS_CELL = 0.6;
const EDGE_SHARE = 0.45;
const EDGE_REACH = Math.max(1, SUBCELLS / 4);
const OPAQUE = 128;
const INK_COVERAGE = 0.02;

/** The picture at one pixel per sub-cell sample, from the pivot on. */
function sampleImage(source, plan) {
  const width = plan.tilesW * SUBCELLS;
  const height = plan.tilesH * SUBCELLS;
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d", { willReadFrequently: true });
  context.imageSmoothingEnabled = true;
  context.imageSmoothingQuality = "high";
  // Exactly the region the cells cover, so a sample pixel and a map pixel mean
  // the same place. Where the last cell hangs over the edge of the picture that
  // part draws as nothing, which reads as nothing — the right answer for a
  // square the map does not reach.
  context.drawImage(
    source,
    plan.originX, plan.originY,
    plan.coveredW, plan.coveredH,
    0, 0, width, height
  );
  return context.getImageData(0, 0, width, height);
}

/** Otsu's split of a histogram, on OpenCV's terms: everything ABOVE is bright. */
function otsuLevel(values) {
  const histogram = new Float64Array(256);
  for (const value of values) histogram[Math.max(0, Math.min(255, Math.round(value)))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * histogram[i];

  let sumB = 0, weightB = 0, best = 0, level = 0;
  for (let i = 0; i < 256; i++) {
    weightB += histogram[i];
    if (!weightB) continue;
    const weightF = total - weightB;
    if (!weightF) break;
    sumB += i * histogram[i];
    const between =
      weightB * weightF * Math.pow(sumB / weightB - (sum - sumB) / weightF, 2);
    if (between > best) { best = between; level = i; }
  }
  return level;
}

/** Blobs of a value, four-connected, labelled from one. */
function connectedComponents(mask, width, height, wanted) {
  const labels = new Int32Array(width * height);
  const queue = new Int32Array(width * height);
  let next = 0;
  for (let start = 0; start < mask.length; start++) {
    if (mask[start] !== wanted || labels[start]) continue;
    next++;
    let head = 0, tail = 0;
    queue[tail++] = start;
    labels[start] = next;
    while (head < tail) {
      const at = queue[head++];
      const x = at % width, y = (at / width) | 0;
      if (x > 0) { const n = at - 1; if (mask[n] === wanted && !labels[n]) { labels[n] = next; queue[tail++] = n; } }
      if (x < width - 1) { const n = at + 1; if (mask[n] === wanted && !labels[n]) { labels[n] = next; queue[tail++] = n; } }
      if (y > 0) { const n = at - width; if (mask[n] === wanted && !labels[n]) { labels[n] = next; queue[tail++] = n; } }
      if (y < height - 1) { const n = at + width; if (mask[n] === wanted && !labels[n]) { labels[n] = next; queue[tail++] = n; } }
    }
  }
  return { labels, count: next };
}

/** Rough distance from anything false, by two chamfer passes. */
function distanceFrom(mask, width, height) {
  const far = 1e6;
  const distance = new Float64Array(width * height);
  for (let i = 0; i < mask.length; i++) distance[i] = mask[i] ? far : 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const at = y * width + x;
      if (!distance[at]) continue;
      let best = distance[at];
      if (x > 0) best = Math.min(best, distance[at - 1] + 1);
      if (y > 0) best = Math.min(best, distance[at - width] + 1);
      if (x > 0 && y > 0) best = Math.min(best, distance[at - width - 1] + 1.41);
      distance[at] = best;
    }
  }
  for (let y = height - 1; y >= 0; y--) {
    for (let x = width - 1; x >= 0; x--) {
      const at = y * width + x;
      if (!distance[at]) continue;
      let best = distance[at];
      if (x < width - 1) best = Math.min(best, distance[at + 1] + 1);
      if (y < height - 1) best = Math.min(best, distance[at + width] + 1);
      if (x < width - 1 && y < height - 1) best = Math.min(best, distance[at + width + 1] + 1.41);
      distance[at] = best;
    }
  }
  return distance;
}

/**
 * Mark whichever of the two drawn tones is the wall.
 *
 * The wall is the tone drawn around the outside — a wall encloses a floor and
 * not the other way about — so distance from the backdrop tells them apart
 * without assuming a wall is darker than the floor it encloses.
 */
function splitTones(classes, brightness, isStone, isDrawn) {
  const stone = [];
  for (let i = 0; i < classes.length; i++) if (isStone[i]) stone.push(brightness[i]);
  if (!stone.length) return;

  const tone = otsuLevel(stone);
  let brightSum = 0, brightCount = 0, dimSum = 0, dimCount = 0;
  for (let i = 0; i < classes.length; i++) {
    if (!isStone[i]) continue;
    if (brightness[i] > tone) { brightSum += brightness[i]; brightCount++; }
    else { dimSum += brightness[i]; dimCount++; }
  }
  if (!brightCount || !dimCount) return;
  if (brightSum / brightCount - dimSum / dimCount < WALL_TONE_GAP) return;

  const distance = distanceFrom(isDrawn, classes.width, classes.height);
  let brightDepth = 0, dimDepth = 0;
  for (let i = 0; i < classes.length; i++) {
    if (!isStone[i]) continue;
    if (brightness[i] > tone) brightDepth += distance[i];
    else dimDepth += distance[i];
  }
  const wallIsDim = dimDepth / dimCount < brightDepth / brightCount;
  for (let i = 0; i < classes.length; i++) {
    if (!isStone[i]) continue;
    const dim = !(brightness[i] > tone);
    if (dim === wallIsDim) classes[i] = WALL;
  }
}

/** Every sub-cell sample as backdrop, floor, wall or water. */
export function classify(source, plan, style = LIT_ON_DARK) {
  if (!STYLES.includes(style)) throw new Error(`${style} is not a style this reads.`);
  const image = sampleImage(source, plan);
  const { width, height, data } = image;
  const count = width * height;

  const classes = new Uint8Array(count);
  classes.width = width;
  classes.height = height;
  const brightness = new Float64Array(count);
  const watery = new Uint8Array(count);
  const drawn = new Uint8Array(count);

  for (let i = 0, p = 0; i < data.length; i += 4, p++) {
    const r = data[i], g = data[i + 1], b = data[i + 2];
    brightness[p] = (r + g + b) / 3;
    watery[p] = (g + b) / 2 > r + WATER_TINT ? 1 : 0;
    drawn[p] = data[i + 3] >= OPAQUE ? 1 : 0;
  }

  if (style === TRANSPARENT) {
    // Once the background is gone what is left is all map, and splitting it by
    // tone no longer separates wall from floor — it separates whatever is
    // darkest from the rest, which is every table, rug and shadow in the
    // place. So it is floor wherever it is anything, and its wall is where it
    // stops being anything.
    for (let i = 0; i < count; i++) {
      if (!drawn[i]) continue;
      classes[i] = watery[i] ? WATER : FLOOR;
    }
    return classes;
  }

  if (style === DARK_ON_LIGHT) {
    // Tone cannot read a sketch: the paper inside a room and the page outside
    // are the same white. What separates them is the ink between — the outside
    // is what a fill reaches from the border without crossing a line.
    const level = otsuLevel(brightness);
    const ink = new Uint8Array(count);
    for (let i = 0; i < count; i++) ink[i] = brightness[i] <= level ? 1 : 0;

    classes.fill(FLOOR);
    for (let i = 0; i < count; i++) if (ink[i]) classes[i] = WALL;

    const { labels } = connectedComponents(ink, width, height, 0);
    const outside = new Set();
    for (let x = 0; x < width; x++) { outside.add(labels[x]); outside.add(labels[(height - 1) * width + x]); }
    for (let y = 0; y < height; y++) { outside.add(labels[y * width]); outside.add(labels[y * width + width - 1]); }
    outside.delete(0);
    for (let i = 0; i < count; i++) {
      if (outside.has(labels[i])) classes[i] = BACKDROP;
      else if (!ink[i] && watery[i]) classes[i] = WATER;
    }
    return classes;
  }

  // A lit map on a dark backdrop: the common battlemap.
  let lowest = 255, highest = 0;
  for (let i = 0; i < count; i++) {
    lowest = Math.min(lowest, brightness[i]);
    highest = Math.max(highest, brightness[i]);
  }
  if (highest - lowest < 12) return classes; // one flat colour: no map here

  const level = otsuLevel(brightness);
  const lit = new Uint8Array(count);
  const stone = new Uint8Array(count);
  for (let i = 0; i < count; i++) {
    lit[i] = brightness[i] > level || watery[i] ? 1 : 0;
    if (!lit[i]) continue;
    classes[i] = watery[i] ? WATER : FLOOR;
    stone[i] = watery[i] ? 0 : 1;
  }
  splitTones(classes, brightness, stone, lit);
  return classes;
}

/** The reading: a label per cell, and which boundaries carry a wall. */
export function readMap(source, plan, { style = LIT_ON_DARK, recognise = null } = {}) {
  const classes = classify(source, plan, style);
  if (recognise && !recognise.has("~")) {
    // Water nobody wants is still somewhere a token can stand.
    for (let i = 0; i < classes.length; i++) if (classes[i] === WATER) classes[i] = FLOOR;
  }

  const width = plan.tilesW * SUBCELLS;
  const rows = [];
  for (let y = 0; y < plan.tilesH; y++) {
    let row = "";
    for (let x = 0; x < plan.tilesW; x++) {
      let floor = 0, wall = 0, water = 0;
      for (let sy = 0; sy < SUBCELLS; sy++) {
        for (let sx = 0; sx < SUBCELLS; sx++) {
          const value = classes[(y * SUBCELLS + sy) * width + x * SUBCELLS + sx];
          if (value === FLOOR) floor++;
          else if (value === WALL) wall++;
          else if (value === WATER) water++;
        }
      }
      const cell = SUBCELLS * SUBCELLS;
      if (water / cell >= FLOOR_SHARE) row += "~";
      else if (wall / cell >= WALL_FILLS_CELL) row += "#";
      else if ((floor + water) / cell >= FLOOR_SHARE) row += ".";
      else row += " ";
    }
    rows.push(row);
  }

  return { rows, edges: findEdges(classes, rows, plan) };
}

function labelAt(rows, x, y) {
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) return " ";
  return rows[y][x];
}

/**
 * Where the walls go.
 *
 * Two things put one on a boundary: a band of wall tone drawn along it, which
 * is what this reader exists for, and a floor that simply stops — plenty of
 * maps draw no wall at all and let the artwork end, and a room with an open
 * side is not a room.
 */
function findEdges(classes, rows, plan) {
  const width = plan.tilesW * SUBCELLS;
  const vertical = new Set();
  const horizontal = new Set();
  const solid = new Set(["#", " "]);

  const bandIsWall = (kind, x, y) => {
    let wall = 0, total = 0;
    if (kind === "vertical") {
      const centre = x * SUBCELLS;
      for (let sy = 0; sy < SUBCELLS; sy++) {
        for (let at = Math.max(0, centre - EDGE_REACH); at < centre + EDGE_REACH; at++) {
          if (at >= width) continue;
          total++;
          if (classes[(y * SUBCELLS + sy) * width + at] === WALL) wall++;
        }
      }
    } else {
      const centre = y * SUBCELLS;
      for (let at = Math.max(0, centre - EDGE_REACH); at < centre + EDGE_REACH; at++) {
        if (at >= plan.tilesH * SUBCELLS) continue;
        for (let sx = 0; sx < SUBCELLS; sx++) {
          total++;
          if (classes[at * width + x * SUBCELLS + sx] === WALL) wall++;
        }
      }
    }
    return total > 0 && wall / total >= EDGE_SHARE;
  };

  const open = (label) => label === "." || label === "~";

  for (let y = 0; y < plan.tilesH; y++) {
    for (let x = 0; x <= plan.tilesW; x++) {
      const here = labelAt(rows, x, y), before = labelAt(rows, x - 1, y);
      const stops = solid.has(here) !== solid.has(before);
      if ((stops || bandIsWall("vertical", x, y)) && (open(here) || open(before))) {
        vertical.add(`${x},${y}`);
      }
    }
  }
  for (let y = 0; y <= plan.tilesH; y++) {
    for (let x = 0; x < plan.tilesW; x++) {
      const here = labelAt(rows, x, y), above = labelAt(rows, x, y - 1);
      const stops = solid.has(here) !== solid.has(above);
      if ((stops || bandIsWall("horizontal", x, y)) && (open(here) || open(above))) {
        horizontal.add(`${x},${y}`);
      }
    }
  }
  return { vertical, horizontal };
}
