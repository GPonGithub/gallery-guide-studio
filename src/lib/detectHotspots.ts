export type DetectedRect = { x: number; y: number; width: number; height: number };

function isBlue(r: number, g: number, b: number, a: number): boolean {
  return a > 200 && b > 180 && b - r > 40 && g > 100 && g < 220;
}

/**
 * Client-side computer-vision pass: given a diagram image with solid-colored
 * "button" rectangles, find their pixel positions (as percentages of the
 * image's natural size) without a server round trip.
 */
export function detectBlueHotspots(img: HTMLImageElement): DetectedRect[] {
  const width = img.naturalWidth;
  const height = img.naturalHeight;
  if (!width || !height) return [];

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return [];
  ctx.drawImage(img, 0, 0, width, height);

  const { data } = ctx.getImageData(0, 0, width, height);
  const mask = new Uint8Array(width * height);
  const rowHasBlue = new Uint8Array(height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      if (isBlue(data[i], data[i + 1], data[i + 2], data[i + 3])) {
        mask[y * width + x] = 1;
        rowHasBlue[y] = 1;
      }
    }
  }

  // Contiguous row bands with any blue pixel.
  const bands: Array<{ startY: number; endY: number }> = [];
  let bandStart = -1;
  for (let y = 0; y < height; y++) {
    if (rowHasBlue[y]) {
      if (bandStart === -1) bandStart = y;
    } else if (bandStart !== -1) {
      bands.push({ startY: bandStart, endY: y - 1 });
      bandStart = -1;
    }
  }
  if (bandStart !== -1) bands.push({ startY: bandStart, endY: height - 1 });

  const rects: DetectedRect[] = [];

  for (const band of bands) {
    // Project mask onto columns within this band's y-range.
    const colHasBlue = new Uint8Array(width);
    for (let x = 0; x < width; x++) {
      for (let y = band.startY; y <= band.endY; y++) {
        if (mask[y * width + x]) {
          colHasBlue[x] = 1;
          break;
        }
      }
    }

    // Contiguous column groups = individual buttons within this band.
    let colStart = -1;
    const groups: Array<{ startX: number; endX: number }> = [];
    for (let x = 0; x < width; x++) {
      if (colHasBlue[x]) {
        if (colStart === -1) colStart = x;
      } else if (colStart !== -1) {
        groups.push({ startX: colStart, endX: x - 1 });
        colStart = -1;
      }
    }
    if (colStart !== -1) groups.push({ startX: colStart, endX: width - 1 });

    for (const group of groups) {
      // Tight bounding box: re-scan just this sub-region for min/max y.
      let minY = band.endY;
      let maxY = band.startY;
      for (let y = band.startY; y <= band.endY; y++) {
        for (let x = group.startX; x <= group.endX; x++) {
          if (mask[y * width + x]) {
            if (y < minY) minY = y;
            if (y > maxY) maxY = y;
          }
        }
      }
      if (maxY < minY) continue;

      const pxX = group.startX;
      const pxY = minY;
      const pxWidth = group.endX - group.startX + 1;
      const pxHeight = maxY - minY + 1;

      // Ignore specks — not plausible "button" size.
      if (pxWidth < 8 || pxHeight < 8) continue;

      rects.push({
        x: (pxX / width) * 100,
        y: (pxY / height) * 100,
        width: (pxWidth / width) * 100,
        height: (pxHeight / height) * 100,
      });
    }
  }

  rects.sort((a, b) => a.y - b.y || a.x - b.x);
  return rects;
}

/**
 * Draws a numbered marker just above each rect (in reading order) onto a
 * copy of the image. Sending this annotated image to a vision model — instead
 * of describing each button's position as text — lets it visually trace each
 * marker up to whatever card/label sits above the button, regardless of how
 * far away that label is or how the diagram is laid out.
 */
// Anthropic downscales any image over this on its long edge before reading
// it anyway, and rejects anything over ~5MB base64-encoded outright — a
// full-resolution export of a multi-card board screenshot can land well
// past both. Scaling down here first keeps the request fast and avoids
// that size rejection, without costing any label-reading accuracy (the
// server-side downscale would happen regardless).
const MAX_LONG_EDGE = 1568;

export function annotateWithMarkers(img: HTMLImageElement, rects: DetectedRect[]): string {
  const naturalWidth = img.naturalWidth;
  const naturalHeight = img.naturalHeight;
  if (!naturalWidth || !naturalHeight) return img.src;

  const scale = Math.min(1, MAX_LONG_EDGE / Math.max(naturalWidth, naturalHeight));
  const width = Math.round(naturalWidth * scale);
  const height = Math.round(naturalHeight * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) return img.src;
  ctx.drawImage(img, 0, 0, width, height);

  const radius = Math.max(16, Math.round(Math.min(width, height) * 0.018));
  ctx.font = `bold ${Math.round(radius * 1.1)}px sans-serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';

  rects.forEach((r, i) => {
    const cx = (r.x / 100) * width + ((r.width / 100) * width) / 2;
    const topY = (r.y / 100) * height;
    const cy = Math.max(radius + 2, topY - radius - 4);

    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#e11d48';
    ctx.fill();
    ctx.lineWidth = Math.max(2, radius * 0.15);
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();

    ctx.fillStyle = '#ffffff';
    ctx.fillText(String(i + 1), cx, cy + 1);
  });

  return canvas.toDataURL('image/png');
}
