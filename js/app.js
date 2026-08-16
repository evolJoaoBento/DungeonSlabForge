/**
 * The page: picture, scale, reading, palette, slabs.
 *
 * Every step runs here in the tab. There is no server, so there is nowhere for
 * a map to be uploaded to, and the asset catalog is shipped with the page so
 * there is nothing to set up before the first map.
 */

import { Catalog } from "./catalog.js";
import { GridPlan, detectGrid } from "./grid.js";
import { readMap } from "./reader.js";
import { place } from "./layout.js";
import { loadThemes } from "./themes.js";
import { buildSlab } from "./slab.js";
import * as talespire from "./talespire.js";
import { makeZoomable } from "./zoom.js";
import { makePalette } from "./palette.js";

const $ = (id) => document.getElementById(id);

/** Packs left out unless asked for. A dungeon has no use for a sci-fi crate,
 *  and leaving the pack in means a search for "crate" can answer with one. */
const SKIP_BY_DEFAULT = /sci-?fi|cyberpunk/i;

const COLOURS = {
  "#": "#6b7280", ".": "#c9b98d", "w": "#8b5a2b", "~": "#3b82f6", "+": "#b45309",
  "D": "#8b4513", ",": "#4ade80", "T": "#15803d", "t": "#d97706", "h": "#f59e0b",
  "C": "#fbbf24", "B": "#93c5fd", "s": "#78350f", "X": "#9ca3af", "^": "#a855f7",
};

const state = {
  ts: null,         // TaleSpire's API, when running as a Symbiote
  maxBytes: undefined,
  assets: null,     // every asset found, before any pack is left out
  specs: null,      // the themes as written, so packs can be re-picked cheaply
  catalog: null,
  themes: null,
  theme: null,
  image: null,      // the picture as it is read: the cut-out one once cut
  original: null,   // what was uploaded, so the cut can be undone
  plan: null,
  reading: null,
};

// --- 1: the picture -----------------------------------------------------------

async function useImage(source, name) {
  // Either a picked file or an <img> already loaded from a path: inside
  // TaleSpire there is no file dialog to open, so a picture more often arrives
  // as something fetched than as something chosen.
  const drawable =
    source instanceof HTMLImageElement ? source : await createImageBitmap(source);
  const canvas = document.createElement("canvas");
  canvas.width = drawable.naturalWidth || drawable.width;
  canvas.height = drawable.naturalHeight || drawable.height;
  canvas.getContext("2d").drawImage(drawable, 0, 0);

  state.image = canvas;
  state.original = canvas;
  $("drop-text").textContent = name;
  $("restore-background").hidden = true;
  $("background-readout").textContent = "";

  const sniff = document.createElement("canvas");
  const scale = Math.min(1, 1400 / Math.max(canvas.width, canvas.height));
  sniff.width = Math.round(canvas.width * scale);
  sniff.height = Math.round(canvas.height * scale);
  const context = sniff.getContext("2d", { willReadFrequently: true });
  context.drawImage(canvas, 0, 0, sniff.width, sniff.height);
  const found = detectGrid(context.getImageData(0, 0, sniff.width, sniff.height));

  const pitch = found ? Math.round(found.pitch / scale) : 70;
  $("upload-info").textContent =
    `${canvas.width} x ${canvas.height} pixels` +
    (found ? ` · grid detected at about ${pitch} px a square` : " · no grid detected, set the scale by eye");
  $("px").max = Math.max(300, Math.ceil(pitch * 1.5));
  $("px").value = pitch;
  $("px-out").value = pitch;
  boundOrigin();
  setOrigin(found ? Math.round(found.originX / scale) : 0, found ? Math.round(found.originY / scale) : 0);

  $("step-grid").hidden = false;
  refreshGrid();
}

$("file").addEventListener("change", (event) => {
  const file = event.target.files[0];
  if (file) useImage(file, file.name).catch(sayUploadFailed);
});

const drop = document.querySelector(".drop");
["dragover", "dragleave", "drop"].forEach((name) =>
  drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.toggle("over", name === "dragover");
    const file = name === "drop" && event.dataTransfer.files[0];
    if (file) useImage(file, file.name).catch(sayUploadFailed);
  })
);

/**
 * Getting a picture in without the file dialog.
 *
 * The dialog works inside TaleSpire, but the game keeps the focus and the
 * dialog opens behind it, which reads exactly like a button that does nothing.
 * These two ways in never leave the panel.
 */

// Ctrl+V. Costs nothing when the clipboard holds no picture, and is the
// shortest path from a screenshot to a map.
window.addEventListener("paste", (event) => {
  const item = [...(event.clipboardData?.items || [])].find((entry) =>
    entry.type.startsWith("image/")
  );
  if (!item) return;
  event.preventDefault();
  useImage(item.getAsFile(), "pasted picture").catch(sayUploadFailed);
});

function loadImageAt(source) {
  return new Promise((settle, fail) => {
    const image = new Image();
    image.onload = () => settle(image);
    image.onerror = () => fail(new Error("nothing there, or not a picture"));
    image.src = source;
  });
}

// A path, resolved against the Symbiote's own folder. A Symbiote cannot read
// outside its directory, so a map has to be copied in beside it — but that is
// a copy the player makes once, and it needs no dialog.
$("load-path").addEventListener("click", async () => {
  const path = $("image-path").value.trim() || "map.png";
  $("upload-info").textContent = `looking for ${path}…`;
  try {
    await useImage(await loadImageAt(path), path);
  } catch (error) {
    $("upload-info").textContent = `Could not load ${path}: ${error.message}`;
  }
});

$("image-path").addEventListener("keydown", (event) => {
  if (event.key === "Enter") $("load-path").click();
});

function sayUploadFailed(error) {
  $("upload-info").textContent = `Could not read that picture: ${error.message}`;
}

$("cut-background").addEventListener("click", async () => {
  $("cut-background").disabled = true;
  $("background-readout").textContent = "fetching the model…";
  try {
    const { removeBackground } = await import("./background.js");
    const { canvas, kept } = await removeBackground(state.original, (report) => {
      if (report?.progress) {
        $("background-readout").textContent = `fetching the model… ${Math.round(report.progress)}%`;
      }
    });
    state.image = canvas;
    $("background-readout").textContent = `${Math.round(kept * 100)}% of the picture kept as map`;
    $("map-style").value = "transparent";
    $("restore-background").hidden = false;
    refreshGrid();
  } catch (error) {
    $("background-readout").textContent = `could not remove the background: ${error.message}`;
  } finally {
    $("cut-background").disabled = false;
  }
});

$("restore-background").addEventListener("click", () => {
  state.image = state.original;
  $("map-style").value = "lit_on_dark";
  $("restore-background").hidden = true;
  $("background-readout").textContent = "";
  refreshGrid();
});

// --- 2: the scale -------------------------------------------------------------

let gridTimer = null;
function scheduleGrid() {
  $("px-out").value = $("px").value;
  boundOrigin();
  clearTimeout(gridTimer);
  gridTimer = setTimeout(refreshGrid, 150);
}

// The pivot only ever needs to move within one square: further along is the
// same grid over again, one cell of map poorer.
function boundOrigin() {
  const pitch = Math.max(1, Math.round(Number($("px").value)) - 1);
  for (const id of ["origin-x", "origin-y"]) {
    $(id).max = pitch;
    if (Number($(id).value) > pitch) $(id).value = pitch;
  }
}

function setOrigin(x, y) {
  boundOrigin();
  $("origin-x").value = x;
  $("origin-y").value = y;
  $("origin-x-out").value = $("origin-x").value;
  $("origin-y-out").value = $("origin-y").value;
}

$("px").addEventListener("input", scheduleGrid);
$("section").addEventListener("change", refreshGrid);
["origin-x", "origin-y"].forEach((id) =>
  $(id).addEventListener("input", () => {
    $(`${id}-out`).value = $(id).value;
    clearTimeout(gridTimer);
    gridTimer = setTimeout(refreshGrid, 150);
  })
);
$("origin-reset").addEventListener("click", () => { setOrigin(0, 0); refreshGrid(); });
$("map-style").addEventListener("change", () => { state.reading = null; drawReading(); });

function refreshGrid() {
  if (!state.image) return;
  try {
    state.plan = new GridPlan({
      imageW: state.image.width,
      imageH: state.image.height,
      pxPerSquare: Number($("px").value),
      sectionTiles: Number($("section").value),
      originX: Number($("origin-x").value),
      originY: Number($("origin-y").value),
    });
  } catch (error) {
    $("grid-readout").textContent = error.message;
    return;
  }
  $("grid-readout").textContent =
    `${state.plan.tilesW} x ${state.plan.tilesH} tiles, ${state.plan.sections.length} section(s)`;
  state.reading = null;
  drawOverlay();
  $("step-labels").hidden = false;
  drawReading();
}

const zoom = {
  overlay: makeZoomable($("overlay").closest(".preview")),
  paint: makeZoomable($("paint").closest(".preview")),
};

function drawOverlay() {
  const canvas = $("overlay");
  const plan = state.plan;
  // Drawn at the picture's own resolution, within reason: the preview is
  // scaled by a transform now, so anything not drawn here cannot be zoomed to.
  const scale = Math.min(1, 2400 / plan.imageW);
  canvas.width = Math.round(plan.imageW * scale);
  canvas.height = Math.round(plan.imageH * scale);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(state.image, 0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(255,64,64,.75)";
  // Thick enough to still be a line when the whole picture is fitted into a
  // side panel, which is the state it is judged in first.
  context.lineWidth = Math.max(1, canvas.width / 900);
  const spanW = plan.imageW - plan.originX;
  const spanH = plan.imageH - plan.originY;
  for (let x = 0; x <= plan.tilesW; x++) {
    const at = (plan.originX + (x * spanW) / plan.tilesW) * scale;
    context.beginPath(); context.moveTo(at, 0); context.lineTo(at, canvas.height); context.stroke();
  }
  for (let y = 0; y <= plan.tilesH; y++) {
    const at = (plan.originY + (y * spanH) / plan.tilesH) * scale;
    context.beginPath(); context.moveTo(0, at); context.lineTo(canvas.width, at); context.stroke();
  }
  zoom.overlay.refit();
}

// --- 3: the reading -----------------------------------------------------------

$("read-map").addEventListener("click", () => {
  const started = performance.now();
  state.reading = readMap(state.image, state.plan, { style: $("map-style").value });
  const floors = state.reading.rows.reduce((a, row) => a + [...row].filter((c) => c !== " ").length, 0);
  const walls = state.reading.edges.vertical.size + state.reading.edges.horizontal.size;
  $("read-readout").textContent =
    `${floors} cells, ${walls} walls on boundaries, in ${Math.round(performance.now() - started)} ms`;
  drawReading();
  $("step-theme").hidden = false;
  $("step-build").hidden = false;
});

function drawReading() {
  const canvas = $("paint");
  const plan = state.plan;
  if (!plan) return;
  const scale = Math.max(6, Math.min(14, Math.floor(900 / plan.tilesW)));
  canvas.width = plan.tilesW * scale;
  canvas.height = plan.tilesH * scale;
  const context = canvas.getContext("2d");
  context.fillStyle = "#101014";
  context.fillRect(0, 0, canvas.width, canvas.height);
  zoom.paint.refit();
  if (!state.reading) return;

  for (let y = 0; y < plan.tilesH; y++) {
    for (let x = 0; x < plan.tilesW; x++) {
      const colour = COLOURS[state.reading.rows[y][x]];
      if (!colour) continue;
      context.fillStyle = colour;
      context.fillRect(x * scale, y * scale, scale, scale);
    }
  }
  context.strokeStyle = "#ff5a5a";
  context.lineWidth = Math.max(1.5, scale * 0.25);
  for (const key of state.reading.edges.vertical) {
    const [x, y] = key.split(",").map(Number);
    context.beginPath(); context.moveTo(x * scale, y * scale); context.lineTo(x * scale, (y + 1) * scale); context.stroke();
  }
  for (const key of state.reading.edges.horizontal) {
    const [x, y] = key.split(",").map(Number);
    context.beginPath(); context.moveTo(x * scale, y * scale); context.lineTo((x + 1) * scale, y * scale); context.stroke();
  }
}

// --- 4: the palette -----------------------------------------------------------

/**
 * The pack tick-list.
 *
 * On the page this is usually one line, because the catalog shipped with it was
 * generated from one pack. In TaleSpire it is however many the player owns, and
 * it matters: their install has the sci-fi pack in it whether this is a
 * cyberpunk map or not.
 */
function fillPacks() {
  const box = $("packs");
  box.innerHTML = "";
  const packs = [...new Set(state.assets.map((asset) => asset.pack))].sort();
  $("packs-box").hidden = packs.length < 2;
  for (const pack of packs) {
    const label = document.createElement("label");
    const tick = document.createElement("input");
    tick.type = "checkbox";
    tick.value = pack;
    tick.checked = !SKIP_BY_DEFAULT.test(pack);
    tick.onchange = usePacks;
    label.append(tick, document.createTextNode(` ${pack}`));
    box.appendChild(label);
  }
}

/** Rebuild the catalog, and every theme with it, from the ticked packs. */
async function usePacks() {
  const wanted = new Set(
    [...$("packs").querySelectorAll("input:checked")].map((tick) => tick.value)
  );
  const assets = state.assets.filter((asset) => wanted.has(asset.pack));
  if (!assets.length) {
    $("theme-readout").textContent = "tick at least one pack";
    return;
  }
  try {
    const catalog = new Catalog(assets);
    // A theme with no floor throws rather than resolving, so the swap happens
    // only once both survive — otherwise unticking the one pack that had a
    // floor would leave the palette showing assets the catalog no longer has.
    const themes = await loadThemes(catalog, state.specs);
    state.catalog = catalog;
    state.themes = themes;
    fillThemes();
  } catch (error) {
    $("theme-readout").textContent = error.message;
  }
}

function fillThemes() {
  const select = $("theme");
  const chosen = select.value;
  select.innerHTML = "";
  for (const [name, theme] of Object.entries(state.themes)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} — ${theme.description}`;
    select.appendChild(option);
  }
  if (chosen && state.themes[chosen]) select.value = chosen;
  applyTheme();
  select.onchange = applyTheme;
}

let palette = null;

function thePalette() {
  if (palette) return palette;
  palette = makePalette({
    into: $("theme-labels"),
    picker: $("picker"),
    thumbnail: (asset) => talespire.thumbnailFor(state.ts, asset),
    onChange: (theme, saved) => {
      state.saved = saved;
      // A null theme is the "automatic" button: the remembered choice is gone,
      // so the answer is whatever resolving it afresh gives.
      if (theme) state.theme = theme;
      else applyTheme();
      talespire.save(state.ts, saved).catch(() => {});
    },
  });
  return palette;
}

function applyTheme() {
  const resolved = state.themes[$("theme").value];
  $("theme-readout").textContent = resolved.warnings.length
    ? `${resolved.warnings.length} label(s) did not resolve`
    : "every label resolved";
  state.theme = thePalette().show(resolved, state.saved);
}

// --- 5: the slabs -------------------------------------------------------------

$("build").addEventListener("click", async () => {
  if (!state.reading) { $("build-readout").textContent = "read the map first"; return; }
  if (!state.theme) { $("build-readout").textContent = "load your packs first"; return; }

  const box = $("sections");
  box.innerHTML = "";
  let built = 0, empty = 0, failed = 0;

  for (const section of state.plan.sections) {
    const placements = place(state.reading.rows, state.reading.edges, section, state.theme);
    const card = document.createElement("div");
    card.className = "slab";
    if (!placements.length) {
      card.classList.add("empty");
      card.innerHTML = `<b>${section.key}</b><small>nothing here</small>`;
      empty++;
    } else {
      try {
        const slab = await buildSlab(placements, state.maxBytes);
        card.innerHTML =
          `<b>${section.key}</b><small>${slab.instanceCount} tiles · ${slab.compressedBytes} bytes</small>`;
        card.onclick = () => takeSlab(card, slab.code);
        built++;
      } catch (error) {
        card.classList.add("empty");
        card.innerHTML = `<b>${section.key}</b><small>${error.message}</small>`;
        failed++;
      }
    }
    box.appendChild(card);
  }
  $("build-readout").textContent =
    `${built} slab(s) ready${empty ? `, ${empty} empty` : ""}${failed ? `, ${failed} too big` : ""}` +
    (state.ts ? " — click one to take it in hand" : " — click one to copy it");
});

/**
 * What clicking a finished section does.
 *
 * In TaleSpire the slab goes straight into the player's hand: they are already
 * in the game, and asking them to copy a string and paste it into the window
 * they are standing in would be a strange thing to do. Everywhere else it goes
 * to the clipboard, which is the only way across.
 */
async function takeSlab(card, code) {
  document.querySelectorAll(".slab.copied").forEach((el) => el.classList.remove("copied"));
  try {
    if (state.ts) await talespire.sendToHand(state.ts, code);
    else await navigator.clipboard.writeText(code);
    card.classList.add("copied");
  } catch (error) {
    $("build-readout").textContent = error.message;
  }
}

// --- start --------------------------------------------------------------------

(async function start() {
  try {
    // The Symbiote build inlines the themes: its own files are served over a
    // scheme of TaleSpire's making, and fetching one is not promised to work.
    state.specs = globalThis.SLABFORGE_THEMES || undefined;

    state.ts = await talespire.connect();
    if (state.ts) {
      // Said before the asset list is read, so the panel still behaves like a
      // panel if reading it goes wrong.
      document.body.classList.add("in-talespire");
      $("drop-text").textContent = "Choose a picture, or paste one with Ctrl+V…";
      $("upload-note").textContent =
        "Choosing a file does open a dialog, but TaleSpire keeps the focus and " +
        "the dialog opens behind the game — alt-tab to it. Two ways round that: " +
        "copy a picture and press Ctrl+V here, or put the file in this " +
        "Symbiote's own folder and type its name above. A Symbiote cannot read " +
        "outside that folder.";
      // Written where it can be read back: the one thing nobody can see from
      // outside the game is what its web view will and will not do.
      $("upload-diagnostics").textContent =
        `served from ${location.protocol}${location.host ? "//" + location.host : ""} · ` +
        `picker ${typeof window.showOpenFilePicker === "function" ? "yes" : "no"} · ` +
        `clipboard ${navigator.clipboard ? "yes" : "no"} · ` +
        `fetch ${typeof fetch === "function" ? "yes" : "no"}`;
      $("build-hint").textContent =
        "Click a section to take it in hand, then place it. Sections are laid " +
        "out in map order. Placing needs GM mode.";

      const { assets, packs } = await talespire.assetsFromPacks(state.ts);
      state.assets = assets;
      state.maxBytes = (await talespire.maxSlabBytes(state.ts)) ?? undefined;
      // Kept whether or not anything went wrong: it is the only view from
      // outside the game of what the game actually said.
      $("pack-dump").textContent = talespire.describePacks(packs);
      $("what-talespire-said").hidden = false;
    } else {
      state.assets = (await Catalog.load()).assets;
    }

    state.saved = await talespire.loadSaved(state.ts);
    state.specs = state.specs || (await (await fetch("./js/themes.json")).json());
    fillPacks();
    await usePacks();
  } catch (error) {
    // Nothing can be built without a catalog, and the last time this failed the
    // message sat in step one where nobody looked. It goes at the top now.
    say(error.message);
  }
})();

function say(message) {
  const banner = $("banner");
  banner.textContent = message;
  banner.hidden = false;
}
