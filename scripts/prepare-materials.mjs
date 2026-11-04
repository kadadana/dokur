import { chromium } from 'playwright';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';

// Preserve the generated originals; prepare smaller alpha-preserving assets for the VSIX.
const directory = resolve('webview/textures');
const browser = await chromium.launch();
try {
  const page = await browser.newPage();
  let total = 0;
  for (const name of (await readdir(join(directory, 'source')))
    .filter((name) => /^(fabric|rope)-.*\.png$/.test(name))
    .sort()) {
    const source = await readFile(join(directory, 'source', name));
    const result = await page.evaluate(
      async ({ encoded, limit }) => {
        const image = new Image();
        image.src = 'data:image/png;base64,' + encoded;
        await image.decode();
        const scale = Math.min(1, limit / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.round(image.naturalWidth * scale);
        canvas.height = Math.round(image.naturalHeight * scale);
        const context = canvas.getContext('2d');
        context.imageSmoothingQuality = 'high';
        context.drawImage(image, 0, 0, canvas.width, canvas.height);
        return canvas.toDataURL('image/webp', 0.87).split(',')[1];
      },
      { encoded: source.toString('base64'), limit: 900 },
    );
    const output = Buffer.from(result, 'base64');
    await writeFile(join(directory, name.replace('.png', '.webp')), output);
    total += output.length;
    console.log(`${name.replace('.png', '.webp')}: ${Math.round(output.length / 1024)} KB`);
  }
  console.log(`Prepared materials: ${Math.round(total / 1024)} KB`);
} finally {
  await browser.close();
}
