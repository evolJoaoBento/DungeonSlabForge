/**
 * Cutting the map out of whatever it was drawn on.
 *
 * Tone alone cannot tell a table drawn in shadow from the empty page around the
 * map: both are nearly black. Measured on one real map, a tone rule threw away
 * 1335 cells of furniture and dark stone the map plainly encloses, while a
 * segmentation model kept 99.9% of what the tone rule found, took half of the
 * dark patches it was dropping, and left 5% of the page — which is the
 * judgement a threshold cannot make, since some of those patches really are
 * nothing.
 *
 * The model is fetched on first use and cached by the browser. Nothing is
 * uploaded: it runs here, on this machine, in WebAssembly.
 */

const LIBRARY = "https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.2";
const MODEL = "briaai/RMBG-1.4";

/** The model works on a shrunk copy: measured on a 6800x8700 map, the answer at
 *  2400 matched the answer at 1600 to a tenth of a percent. */
const WORKING_MAX = 1024;

/** Islands and holes smaller than this share of the picture are noise: the
 *  model leaves a scatter of specks out in the page, and each one would read as
 *  a stray floor cell to rub out by hand. */
const SPECK_SHARE = 0.0002;

const OPAQUE = 128;

let remover = null;

export async function loadRemover(onProgress) {
  if (remover) return remover;
  const { pipeline, env } = await import(/* @vite-ignore */ LIBRARY);
  env.allowLocalModels = false;
  remover = await pipeline("background-removal", MODEL, {
    progress_callback: onProgress,
  });
  return remover;
}

/** The mask with its loose specks dropped and its pinholes filled. */
function withoutSpecks(mask, width, height) {
  const smallest = Math.max(1, Math.round(SPECK_SHARE * width * height));
  const queue = new Int32Array(width * height);

  for (const wanted of [1, 0]) {
    const seen = new Uint8Array(width * height);
    for (let start = 0; start < mask.length; start++) {
      if (mask[start] !== wanted || seen[start]) continue;
      let head = 0, tail = 0, size = 0;
      queue[tail++] = start;
      seen[start] = 1;
      const blob = [];
      while (head < tail) {
        const at = queue[head++];
        blob.push(at);
        size++;
        const x = at % width, y = (at / width) | 0;
        const around = [];
        if (x > 0) around.push(at - 1);
        if (x < width - 1) around.push(at + 1);
        if (y > 0) around.push(at - width);
        if (y < height - 1) around.push(at + width);
        for (const n of around) {
          if (mask[n] === wanted && !seen[n]) { seen[n] = 1; queue[tail++] = n; }
        }
      }
      if (size < smallest) for (const at of blob) mask[at] = wanted ? 0 : 1;
    }
  }
  return mask;
}

/**
 * The picture with everything that is not the map made transparent.
 *
 * The model sees a shrunk copy and its answer is scaled back onto the original,
 * so what comes out is the full-resolution picture with an alpha channel, not a
 * smaller picture.
 */
export async function removeBackground(source, onProgress) {
  const model = await loadRemover(onProgress);

  const scale = Math.min(1, WORKING_MAX / Math.max(source.width, source.height));
  const workW = Math.max(1, Math.round(source.width * scale));
  const workH = Math.max(1, Math.round(source.height * scale));

  const small = document.createElement("canvas");
  small.width = workW;
  small.height = workH;
  small.getContext("2d").drawImage(source, 0, 0, workW, workH);

  const [cut] = await model(small.toDataURL("image/png"));
  const cutCanvas = document.createElement("canvas");
  cutCanvas.width = workW;
  cutCanvas.height = workH;
  const cutContext = cutCanvas.getContext("2d", { willReadFrequently: true });
  cutContext.drawImage(await createImageBitmap(await cut.toBlob()), 0, 0, workW, workH);

  const cutData = cutContext.getImageData(0, 0, workW, workH);
  const mask = new Uint8Array(workW * workH);
  for (let i = 3, p = 0; i < cutData.data.length; i += 4, p++) {
    mask[p] = cutData.data[i] >= OPAQUE ? 1 : 0;
  }
  withoutSpecks(mask, workW, workH);

  for (let i = 3, p = 0; i < cutData.data.length; i += 4, p++) {
    cutData.data[i] = mask[p] ? 255 : 0;
  }
  cutContext.putImageData(cutData, 0, 0);

  // The alpha scaled back up and laid over the original picture.
  const out = document.createElement("canvas");
  out.width = source.width;
  out.height = source.height;
  const context = out.getContext("2d");
  context.drawImage(source, 0, 0);
  context.globalCompositeOperation = "destination-in";
  context.drawImage(cutCanvas, 0, 0, source.width, source.height);
  context.globalCompositeOperation = "source-over";

  const kept = mask.reduce((a, v) => a + v, 0) / mask.length;
  return { canvas: out, kept };
}
