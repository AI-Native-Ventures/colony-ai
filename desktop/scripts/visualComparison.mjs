/**
 * @typedef {{ width: number, height: number, pixels: Uint8Array }} RgbaImage
 */

/**
 * Build a reference-left/app-right comparison plus a 50 percent overlay and
 * exact RGB difference metrics for two same-size RGBA screenshots.
 *
 * @param {RgbaImage} reference
 * @param {RgbaImage} app
 */
export function compareImages(reference, app) {
  const { width, height } = reference;
  if (width !== app.width || height !== app.height) {
    throw new Error("Images must have matching dimensions.");
  }

  const totalPixels = width * height;
  const rgbaLength = totalPixels * 4;
  if (
    reference.pixels.length !== rgbaLength ||
    app.pixels.length !== rgbaLength
  ) {
    throw new Error("Image pixel buffers must match their dimensions.");
  }

  const heatmap = new Uint8Array(rgbaLength);
  const overlay = new Uint8Array(rgbaLength);
  const sideBySide = new Uint8Array(width * 2 * height * 4);
  const changedMask = new Uint8Array(totalPixels);
  let changedPixels = 0;
  let absoluteDelta = 0;

  for (let pixel = 0; pixel < totalPixels; pixel += 1) {
    const offset = pixel * 4;
    let maxDelta = 0;
    for (let channel = 0; channel < 3; channel += 1) {
      const referenceValue = reference.pixels[offset + channel];
      const appValue = app.pixels[offset + channel];
      const delta = Math.abs(referenceValue - appValue);
      absoluteDelta += delta;
      maxDelta = Math.max(maxDelta, delta);
      overlay[offset + channel] = Math.round((referenceValue + appValue) / 2);
      heatmap[offset + channel] = Math.min(255, delta * 5);
    }
    overlay[offset + 3] = 255;
    heatmap[offset + 3] = 255;
    if (maxDelta > 0) {
      changedMask[pixel] = 1;
      changedPixels += 1;
    }
  }

  const sourceRowBytes = width * 4;
  const outputRowBytes = width * 2 * 4;
  for (let y = 0; y < height; y += 1) {
    const sourceRowOffset = y * sourceRowBytes;
    const outputRowOffset = y * outputRowBytes;
    sideBySide.set(
      reference.pixels.subarray(
        sourceRowOffset,
        sourceRowOffset + sourceRowBytes,
      ),
      outputRowOffset,
    );
    sideBySide.set(
      app.pixels.subarray(sourceRowOffset, sourceRowOffset + sourceRowBytes),
      outputRowOffset + sourceRowBytes,
    );
  }

  const largestDiffRegions = findDiffRegions(changedMask, width, height);
  return {
    changedPixels,
    totalPixels,
    changedPixelRatio: totalPixels === 0 ? 0 : changedPixels / totalPixels,
    meanAbsoluteChannelDelta: absoluteDelta / (totalPixels * 3),
    diffComponentCount: largestDiffRegions.count,
    largestDiffRegions: largestDiffRegions.top,
    sideBySide: { width: width * 2, height, pixels: sideBySide },
    overlay: { width, height, pixels: overlay },
    heatmap: { width, height, pixels: heatmap },
  };
}

function findDiffRegions(mask, width, height) {
  const visited = new Uint8Array(mask.length);
  const queue = new Int32Array(mask.length);
  const top = [];
  let count = 0;

  for (let start = 0; start < mask.length; start += 1) {
    if (mask[start] === 0 || visited[start] !== 0) continue;
    count += 1;
    let head = 0;
    let tail = 0;
    let minX = width;
    let minY = height;
    let maxX = 0;
    let maxY = 0;
    visited[start] = 1;
    queue[tail++] = start;

    while (head < tail) {
      const current = queue[head++];
      const x = current % width;
      const y = Math.floor(current / width);
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
      for (let dy = -1; dy <= 1; dy += 1) {
        const nextY = y + dy;
        if (nextY < 0 || nextY >= height) continue;
        for (let dx = -1; dx <= 1; dx += 1) {
          if (dx === 0 && dy === 0) continue;
          const nextX = x + dx;
          if (nextX < 0 || nextX >= width) continue;
          const next = nextY * width + nextX;
          if (mask[next] === 1 && visited[next] === 0) {
            visited[next] = 1;
            queue[tail++] = next;
          }
        }
      }
    }
    top.push({
      x: minX,
      y: minY,
      width: maxX - minX + 1,
      height: maxY - minY + 1,
      pixels: tail,
    });
  }
  top.sort(
    (a, b) => b.pixels - a.pixels || b.width * b.height - a.width * a.height,
  );
  return { count, top: top.slice(0, 10) };
}
