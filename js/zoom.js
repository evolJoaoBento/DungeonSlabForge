/**
 * Zoom and pan for a canvas preview.
 *
 * A Symbiote lives in a side panel a few hundred pixels wide. A map drawn to
 * fit that is a thumbnail, and lining a grid up against a thumbnail is guessing
 * — so the two previews scale and drag instead of being shrunk to fit once.
 *
 * The canvas keeps its own resolution and a transform does the scaling, so
 * zooming in shows the pixels that are there rather than a resampled copy of a
 * small one. Redrawing is left alone: it happens on every nudge of the scale
 * slider, and a preview that jumped back to fit each time would be unusable.
 * Hence `refit`, which only acts while nobody has zoomed by hand.
 */

const clamp = (value, low, high) => Math.min(high, Math.max(low, value));

export function makeZoomable(preview, { min = 0.05, max = 24 } = {}) {
  const canvas = preview.querySelector("canvas");
  if (!canvas) throw new Error("A zoomable preview needs a canvas in it.");

  const stage = document.createElement("div");
  stage.className = "zoom-stage";
  preview.insertBefore(stage, canvas);
  stage.appendChild(canvas);

  let scale = 1;
  let x = 0;
  let y = 0;
  let touched = false;

  function apply() {
    stage.style.transform = `translate(${x}px, ${y}px) scale(${scale})`;
    readout.textContent = `${Math.round(scale * 100)}%`;
  }

  /** Sit the whole picture in the middle of the box. */
  function fit() {
    const box = preview.getBoundingClientRect();
    if (!box.width || !box.height || !canvas.width || !canvas.height) return;
    scale = clamp(Math.min(box.width / canvas.width, box.height / canvas.height), min, max);
    x = (box.width - canvas.width * scale) / 2;
    y = (box.height - canvas.height * scale) / 2;
    touched = false;
    apply();
  }

  /** Fit again after a redraw, unless the view is one somebody chose. */
  function refit() {
    if (!touched) fit();
  }

  function zoomAbout(clientX, clientY, factor) {
    const box = preview.getBoundingClientRect();
    const atX = clientX - box.left;
    const atY = clientY - box.top;
    const next = clamp(scale * factor, min, max);
    if (next === scale) return;
    // Keep whatever is under the pointer under the pointer.
    x = atX - (atX - x) * (next / scale);
    y = atY - (atY - y) * (next / scale);
    scale = next;
    touched = true;
    apply();
  }

  preview.addEventListener(
    "wheel",
    (event) => {
      event.preventDefault();
      zoomAbout(event.clientX, event.clientY, Math.exp(-event.deltaY * 0.0015));
    },
    { passive: false }
  );

  let dragging = null;
  preview.addEventListener("pointerdown", (event) => {
    if (event.button !== 0 || event.target.closest(".zoom-controls")) return;
    dragging = { atX: event.clientX - x, atY: event.clientY - y };
    preview.setPointerCapture(event.pointerId);
    preview.classList.add("dragging");
  });
  preview.addEventListener("pointermove", (event) => {
    if (!dragging) return;
    x = event.clientX - dragging.atX;
    y = event.clientY - dragging.atY;
    touched = true;
    apply();
  });
  for (const name of ["pointerup", "pointercancel", "pointerleave"]) {
    preview.addEventListener(name, () => {
      dragging = null;
      preview.classList.remove("dragging");
    });
  }
  preview.addEventListener("dblclick", fit);

  const controls = document.createElement("div");
  controls.className = "zoom-controls";
  const readout = document.createElement("span");
  readout.className = "zoom-readout";

  const button = (text, title, act) => {
    const element = document.createElement("button");
    element.type = "button";
    element.textContent = text;
    element.title = title;
    element.onclick = act;
    return element;
  };
  const middle = () => {
    const box = preview.getBoundingClientRect();
    return [box.left + box.width / 2, box.top + box.height / 2];
  };
  controls.append(
    button("−", "Zoom out", () => zoomAbout(...middle(), 1 / 1.4)),
    readout,
    button("+", "Zoom in", () => zoomAbout(...middle(), 1.4)),
    button("⤢", "Fit (or double-click)", fit)
  );
  preview.appendChild(controls);

  // The canvas is resized whenever it is redrawn, and that is the moment a fit
  // is worth redoing.
  if (typeof ResizeObserver === "function") {
    new ResizeObserver(refit).observe(canvas);
  }

  apply();
  return { fit, refit };
}
