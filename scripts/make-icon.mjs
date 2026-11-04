import { chromium } from '@playwright/test';
import { readFile } from 'node:fs/promises';
const svg = await readFile('media/icon.svg', 'utf8');
const browser = await chromium.launch({ headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 128, height: 128 }, deviceScaleFactor: 2 });
  await page.setContent(`<html><body style="margin:0;background:transparent">${svg}</body></html>`);
  await page.screenshot({ path: 'media/icon.png', omitBackground: true });
} finally { await browser.close(); }
