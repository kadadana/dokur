type Bounds = { x: number; y: number; width: number; height: number };
const images = new Map<string, Promise<HTMLImageElement>>();
const boundsCache = new WeakMap<HTMLImageElement, Bounds>();

export function materialAssetUrl(asset: string): string {
  const script = document.querySelector<HTMLScriptElement>('script[src$="webview.js"]');
  return new URL(asset, script?.src ?? document.baseURI).href;
}
export function loadMaterialImage(asset: string): Promise<HTMLImageElement> {
  let image = images.get(asset);
  if (!image) {
    image = new Promise((resolve, reject) => {
      const value = new Image();
      value.crossOrigin = 'anonymous';
      value.onload = () => resolve(value);
      value.onerror = () => reject(new Error('The local textile material could not be loaded.'));
      value.src = materialAssetUrl(asset);
    });
    images.set(asset, image);
  }
  return image;
}
export function materialBounds(image: HTMLImageElement): Bounds {
  const cached = boundsCache.get(image);
  if (cached) return cached;
  const canvas = document.createElement('canvas');
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext('2d', { willReadFrequently: true });
  if (!context) throw new Error('Canvas is unavailable.');
  context.drawImage(image, 0, 0);
  const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
  let left = canvas.width,
    right = -1,
    top = canvas.height,
    bottom = -1;
  for (let y = 0; y < canvas.height; y++)
    for (let x = 0; x < canvas.width; x++)
      if (pixels[(y * canvas.width + x) * 4 + 3] >= 48) {
        left = Math.min(left, x);
        right = Math.max(right, x);
        top = Math.min(top, y);
        bottom = Math.max(bottom, y);
      }
  if (right < left) throw new Error('The material is empty.');
  const result = { x: left, y: top, width: right - left + 1, height: bottom - top + 1 };
  boundsCache.set(image, result);
  return result;
}
