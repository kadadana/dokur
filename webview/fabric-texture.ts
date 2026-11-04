import { loadMaterialImage } from './material-images';
import { materialFor } from './materials';

export type FabricRaster = {
  url: string;
  clipPath: string;
  ports: { left: number; right: number; top: number; bottom: number };
};
const cache = new Map<string, FabricRaster>();

/** Nine slices preserve the photographed tears and fibers as the property tree grows. */
export async function renderFabric(
  kind: string,
  width: number,
  height: number,
): Promise<FabricRaster> {
  const key = `${kind}:${width}:${height}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const image = await loadMaterialImage(materialFor(kind).fabric);
  const scale = 2;
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(width * scale);
  canvas.height = Math.round(height * scale);
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable.');
  context.scale(scale, scale);
  context.imageSmoothingQuality = 'high';
  const border = Math.min(24, width / 4, height / 4);
  const sx = [0, image.naturalWidth * 0.15, image.naturalWidth * 0.85, image.naturalWidth];
  const sy = [0, image.naturalHeight * 0.12, image.naturalHeight * 0.88, image.naturalHeight];
  const dx = [0, border, width - border, width],
    dy = [0, border, height - border, height];
  for (let row = 0; row < 3; row++)
    for (let column = 0; column < 3; column++)
      context.drawImage(
        image,
        sx[column],
        sy[row],
        sx[column + 1] - sx[column],
        sy[row + 1] - sy[row],
        dx[column],
        dy[row],
        dx[column + 1] - dx[column],
        dy[row + 1] - dy[row],
      );
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  const alpha = (x: number, y: number) => {
    const px = Math.max(0, Math.min(canvas.width - 1, Math.round(x * scale)));
    const py = Math.max(0, Math.min(canvas.height - 1, Math.round(y * scale)));
    return pixels[(py * canvas.width + px) * 4 + 3];
  };
  const solid = (x: number, y: number) => {
    let sum = 0;
    for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) sum += alpha(x + ox, y + oy);
    return sum / 9 >= 140;
  };
  const outline: string[] = [];
  const cx = width / 2,
    cy = height / 2;
  for (let i = 0; i < 256; i++) {
    const angle = (i / 256) * Math.PI * 2,
      vx = Math.cos(angle),
      vy = Math.sin(angle);
    const limit = Math.min(Math.abs(cx / vx), Math.abs(cy / vy));
    let distance = limit;
    while (distance > 0 && !solid(cx + vx * distance, cy + vy * distance)) distance--;
    outline.push(`${(cx + vx * distance).toFixed(1)}px ${(cy + vy * distance).toFixed(1)}px`);
  }
  const inset = (side: 'left' | 'right' | 'top' | 'bottom') => {
    const length = side === 'left' || side === 'right' ? width : height;
    for (let distance = 0; distance < length / 2; distance += 0.5) {
      const x = side === 'left' ? distance : side === 'right' ? width - distance : cx;
      const y = side === 'top' ? distance : side === 'bottom' ? height - distance : cy;
      if (solid(x, y)) return distance;
    }
    return 0;
  };
  const result = {
    url: canvas.toDataURL('image/png'),
    clipPath: `polygon(${outline.join(',')})`,
    ports: {
      left: inset('left'),
      right: inset('right'),
      top: inset('top'),
      bottom: inset('bottom'),
    },
  };
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
