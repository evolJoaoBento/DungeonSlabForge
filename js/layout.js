/**
 * Labels in, placements out. No picture, no model — just geometry.
 *
 * Two things are easy to get wrong and are handled here on purpose. The whole
 * map's labels are passed in alongside the section being emitted, not the
 * section's slice, because a door on a seam has its wall neighbours in the next
 * section along. And the vertical lift comes from the theme, not from the
 * section's contents, or two sections step apart at the seam.
 */

export const UNITS_PER_TILE = 100;
export const HALF_TILE = 50;

/** Every slab is laid out one cell in from its origin: a wall drawn on the far
 *  side of the first cell sits half a cell before it, and slab coordinates
 *  cannot be negative. The same margin for every section is what keeps two of
 *  them aligned when pasted side by side. */
export const MARGIN = UNITS_PER_TILE;

const TILE_VERTICAL_STEP = 25;
const WALL_LIKE = new Set(["#", "+", "D"]);
const NEEDS_FLOOR = new Set([".", "+", "D", "T", "t", "h", "C", "B", "s", "X"]);
const PROPS = { T: "tree", t: "table", h: "chair", C: "chest", B: "bed", s: "shelf", X: "clutter" };

/**
 * Which way a tile is turned to face an open cell, by the direction that cell
 * lies in as the picture counts them: x right, y down the page.
 *
 * The y sign is flipped on the way out, so a wall facing down the picture faces
 * the same way in the game — but which way the degrees themselves run is a fact
 * about TaleSpire that only TaleSpire can settle. If every wall comes out a
 * quarter turn from where it belongs, this table is the one place to turn it.
 */
const FACING = { "0,1": 0, "-1,0": 90, "0,-1": 180, "1,0": 270 };

const snap = (units) => Math.round(units / TILE_VERTICAL_STEP) * TILE_VERTICAL_STEP;

function labelAt(rows, x, y) {
  if (y < 0 || y >= rows.length || x < 0 || x >= rows[0].length) return " ";
  return rows[y][x];
}

const isOpen = (label) => label !== " " && !WALL_LIKE.has(label);

function heightUnits(theme, label) {
  const asset = theme.assets[label];
  return asset ? snap(asset.height * UNITS_PER_TILE) : 0;
}

/** A stable pseudo-random rotation for scatter props: the same map must give
 *  the same slab every time, so this is a hash of the cell, not a random. */
function propRotation(seed, x, y) {
  let hash = 2166136261 ^ seed;
  for (const char of `${seed}:${x}:${y}`) {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619) >>> 0;
  }
  return (hash % 24) * 15;
}

function doorRotation(rows, x, y) {
  const eastWest = WALL_LIKE.has(labelAt(rows, x - 1, y)) || WALL_LIKE.has(labelAt(rows, x + 1, y));
  const northSouth = WALL_LIKE.has(labelAt(rows, x, y - 1)) || WALL_LIKE.has(labelAt(rows, x, y + 1));
  return northSouth && !eastWest ? 90 : 0;
}

/** Turn a wall tile to face the space it encloses. A wall tile has a front, and
 *  emitting every one unrotated is what makes a built map read as a field of
 *  blocks: half of them face into the rock behind them. */
function wallRotation(rows, x, y) {
  for (const [step, degree] of Object.entries(FACING)) {
    const [dx, dy] = step.split(",").map(Number);
    if (isOpen(labelAt(rows, x + dx, y + dy))) return degree;
  }
  return 0;
}

function cellPlacements(rows, theme, label, gx, gy, lx, ly, seed, base, out) {
  const asset = (name) => theme.assets[name];
  const put = (a, z, degree = 0) => out.push({ assetId: a.id, x: lx, y: ly, z, degree });

  if (NEEDS_FLOOR.has(label) && asset("floor")) put(asset("floor"), base);
  if (label === ".") return;

  if (label === "w") {
    const wood = asset("wood_floor") || asset("floor");
    if (wood) put(wood, base);
    return;
  }
  if (label === "#") {
    const wall = asset("wall");
    if (!wall) return;
    const step = heightUnits(theme, "wall");
    const facing = wallRotation(rows, gx, gy);
    for (let layer = 0; layer < theme.wallLayers; layer++) put(wall, base + layer * step, facing);
    return;
  }
  if (label === "~") {
    const water = asset("water");
    if (water) put(water, base - (theme.sinks.water || 0) * UNITS_PER_TILE);
    return;
  }
  if (label === "+" || label === "D") {
    const door = asset(label === "+" ? "door" : "double_door");
    if (door) put(door, base, doorRotation(rows, gx, gy));
    return;
  }
  if (label === ",") {
    const grass = asset("grass");
    if (grass) put(grass, base);
    return;
  }
  if (PROPS[label]) {
    const prop = asset(PROPS[label]);
    if (prop) {
      out.push({
        assetId: prop.id,
        x: lx,
        y: ly,
        z: base + heightUnits(theme, "floor"),
        degree: propRotation(seed, gx, gy),
        isProp: true,
      });
    }
    return;
  }
  if (label === "^") {
    // No rotation: a flat grid carries no elevation to orient stairs against,
    // and a guess would be wrong half the time.
    const stairs = asset("stairs");
    if (stairs) put(stairs, base);
  }
}

/** Walls for the boundaries this section owns. */
function boundaryPlacements(rows, edges, section, theme, out) {
  const wall = theme.assets.wall;
  if (!wall) return;
  const step = heightUnits(theme, "wall");

  for (const kind of ["vertical", "horizontal"]) {
    for (const key of edges[kind]) {
      const [gx, gy] = key.split(",").map(Number);
      const localX = gx - section.x0;
      const localY = gy - section.y0;
      const spanX = kind === "vertical" ? section.width + 1 : section.width;
      const spanY = kind === "vertical" ? section.height : section.height + 1;
      if (localX < 0 || localY < 0 || localX >= spanX || localY >= spanY) continue;

      let x, y, facing;
      if (kind === "vertical") {
        x = MARGIN + localX * UNITS_PER_TILE - HALF_TILE;
        y = MARGIN + (section.height - 1 - localY) * UNITS_PER_TILE;
        facing = isOpen(labelAt(rows, gx, gy)) ? FACING["1,0"] : FACING["-1,0"];
      } else {
        x = MARGIN + localX * UNITS_PER_TILE;
        y = MARGIN + (section.height - 1 - localY) * UNITS_PER_TILE + HALF_TILE;
        facing = isOpen(labelAt(rows, gx, gy)) ? FACING["0,1"] : FACING["0,-1"];
      }
      for (let layer = 0; layer < theme.wallLayers; layer++) {
        out.push({ assetId: wall.id, x, y, z: theme.baseZ + layer * step, degree: facing });
      }
    }
  }
}

/**
 * Placements for one section, in that section's own coordinates.
 *
 * The rows come out reversed: a picture numbers its rows downwards and
 * TaleSpire numbers its depth the other way, so a slab built row for row
 * pastes in mirrored.
 */
export function place(rows, edges, section, theme, seed = 0) {
  const out = [];
  const base = theme.baseZ;

  for (let row = 0; row < section.height; row++) {
    const gy = section.y0 + row;
    // Flipped about the section's own height: a partial edge section is a slab
    // in its own right and has to stand up alone.
    const ly = MARGIN + (section.height - 1 - row) * UNITS_PER_TILE;
    for (let col = 0; col < section.width; col++) {
      const gx = section.x0 + col;
      const label = labelAt(rows, gx, gy);
      if (label === " ") continue;
      cellPlacements(rows, theme, label, gx, gy, MARGIN + col * UNITS_PER_TILE, ly, seed, base, out);
    }
  }
  if (edges) boundaryPlacements(rows, edges, section, theme, out);
  return out;
}
