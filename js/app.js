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

const $ = (id) => document.getElementById(id);

const COLOURS = {
  "#": "#6b7280", ".": "#c9b98d", "w": "#8b5a2b", "~": "#3b82f6", "+": "#b45309",
  "D": "#8b4513", ",": "#4ade80", "T": "#15803d", "t": "#d97706", "h": "#f59e0b",
  "C": "#fbbf24", "B": "#93c5fd", "s": "#78350f", "X": "#9ca3af", "^": "#a855f7",
};

const state = {
  catalog: null,
  themes: null,
  theme: null,
  image: null,      // the picture as it is read: the cut-out one once cut
  original: null,   // what was uploaded, so the cut can be undone
  plan: null,
  reading: null,
};

// --- 1: the picture -----------------------------------------------------------

async function useImage(file) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");
  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  canvas.getContext("2d").drawImage(bitmap, 0, 0);

  state.image = canvas;
  state.original = canvas;
  $("drop-text").textContent = file.name;
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

$("file").addEventListener("change", (e) => e.target.files[0] && useImage(e.target.files[0]));
const drop = document.querySelector(".drop");
["dragover", "dragleave", "drop"].forEach((name) =>
  drop.addEventListener(name, (event) => {
    event.preventDefault();
    drop.classList.toggle("over", name === "dragover");
    if (name === "drop" && event.dataTransfer.files[0]) useImage(event.dataTransfer.files[0]);
  })
);

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

function drawOverlay() {
  const canvas = $("overlay");
  const plan = state.plan;
  const scale = Math.min(1, 900 / plan.imageW);
  canvas.width = Math.round(plan.imageW * scale);
  canvas.height = Math.round(plan.imageH * scale);
  const context = canvas.getContext("2d");
  context.clearRect(0, 0, canvas.width, canvas.height);
  context.drawImage(state.image, 0, 0, canvas.width, canvas.height);

  context.strokeStyle = "rgba(255,64,64,.75)";
  context.lineWidth = 1;
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
  const scale = Math.max(3, Math.min(14, Math.floor(900 / plan.tilesW)));
  canvas.width = plan.tilesW * scale;
  canvas.height = plan.tilesH * scale;
  const context = canvas.getContext("2d");
  context.fillStyle = "#101014";
  context.fillRect(0, 0, canvas.width, canvas.height);
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

function fillThemes() {
  const select = $("theme");
  select.innerHTML = "";
  for (const [name, theme] of Object.entries(state.themes)) {
    const option = document.createElement("option");
    option.value = name;
    option.textContent = `${name} — ${theme.description}`;
    select.appendChild(option);
  }
  applyTheme();
  select.onchange = applyTheme;
}

function applyTheme() {
  state.theme = state.themes[$("theme").value];
  $("theme-readout").textContent = state.theme.warnings.length
    ? `${state.theme.warnings.length} label(s) did not resolve`
    : "every label resolved";

  const box = $("theme-labels");
  box.innerHTML = "";
  for (const [label, asset] of Object.entries(state.theme.assets)) {
    const row = document.createElement("div");
    row.className = "row";
    const title = document.createElement("b");
    title.textContent = label;
    row.appendChild(title);

    const select = document.createElement("select");
    const options = state.theme.alternativesFor(label);
    const shown = options.length ? options : [asset];
    for (const option of shown.slice(0, 400)) {
      const el = document.createElement("option");
      el.value = option.id;
      el.textContent = option.name;
      el.selected = option.id === asset.id;
      select.appendChild(el);
    }
    select.onchange = () => { state.theme = state.theme.withOverride(label, select.value); };
    row.appendChild(select);
    box.appendChild(row);
  }
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
        const slab = await buildSlab(placements);
        card.innerHTML =
          `<b>${section.key}</b><small>${slab.instanceCount} tiles · ${slab.compressedBytes} bytes</small>`;
        card.onclick = async () => {
          await navigator.clipboard.writeText(slab.code);
          document.querySelectorAll(".slab.copied").forEach((el) => el.classList.remove("copied"));
          card.classList.add("copied");
        };
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
    " — click one to copy it";
});

// --- start --------------------------------------------------------------------

(async function start() {
  try {
    state.catalog = await Catalog.load();
    state.themes = await loadThemes(state.catalog);
    fillThemes();
  } catch (error) {
    // Without a catalog nothing can be built, so say so where it will be read
    // rather than failing quietly at the last step.
    $("upload-info").textContent = error.message;
  }
})();
