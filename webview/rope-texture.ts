import { materialFor } from './materials';
import { loadMaterialImage, materialBounds } from './material-images';

export type RopeRaster = { url: string; x: number; y: number; width: number; height: number };
const cache = new Map<string, RopeRaster>();

/** Maps photographic cotton fibers along the curve instead of drawing synthetic dash marks. */
export async function renderRope(
  path: string,
  diameter: number,
  materialKind = 'configs',
  signal?: AbortSignal,
): Promise<RopeRaster | undefined> {
  const key = `${materialKind}:${diameter}:${path}`;
  const cached = cache.get(key);
  if (cached) return cached;
  const image = await loadMaterialImage(materialFor(materialKind).rope);
  if (signal?.aborted) return;
  const texture = { image, ...materialBounds(image) };
  const geometry = document.createElementNS('http://www.w3.org/2000/svg', 'path');
  geometry.setAttribute('d', path);
  const length = geometry.getTotalLength();
  if (!Number.isFinite(length) || length <= 0) throw new Error('Empty connection path.');
  const steps = Math.min(1400, Math.max(2, Math.ceil(length / 2.5)));
  const step = length / steps;
  const points = Array.from({ length: steps + 1 }, (_, i) => geometry.getPointAtLength(i * step));
  const padding = diameter / 2 + 3;
  const x = Math.min(...points.map((point) => point.x)) - padding;
  const y = Math.min(...points.map((point) => point.y)) - padding;
  const width = Math.max(...points.map((point) => point.x)) - x + padding;
  const height = Math.max(...points.map((point) => point.y)) - y + padding;
  const scale = Math.min(2, 2048 / Math.max(width, height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.ceil(width * scale));
  canvas.height = Math.max(1, Math.ceil(height * scale));
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Canvas is unavailable.');
  context.scale(scale, scale);
  context.imageSmoothingQuality = 'high';
  const texels = texture.height / diameter;
  for (let i = 0; i < steps; i++) {
    const a = points[i],
      b = points[i + 1];
    const distance = Math.hypot(b.x - a.x, b.y - a.y);
    if (distance < 0.001) continue;
    const sourceX = (i * step * texels) % texture.width;
    const sourceWidth = Math.min((distance + 0.6) * texels, texture.width - sourceX);
    context.save();
    context.translate((a.x + b.x) / 2 - x, (a.y + b.y) / 2 - y);
    context.rotate(Math.atan2(b.y - a.y, b.x - a.x));
    context.drawImage(
      texture.image,
      texture.x + sourceX,
      texture.y,
      sourceWidth,
      texture.height,
      -(distance + 0.6) / 2,
      -diameter / 2,
      distance + 0.6,
      diameter,
    );
    context.restore();
  }
  const result = { url: canvas.toDataURL('image/png'), x, y, width, height };
  if (cache.size >= 32) cache.delete(cache.keys().next().value!);
  cache.set(key, result);
  return result;
}
