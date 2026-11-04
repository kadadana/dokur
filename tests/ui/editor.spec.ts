import { test, expect, type Page, type APIRequestContext } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
const state = async (request: APIRequestContext) => (await request.get('/api/state')).json();
const node = (page: Page, id: string) => page.locator(`.react-flow__node[data-id="${id}"]`);
async function dropArrow(
  page: Page,
  id = 'services/api',
  target?: { x: number; y: number },
  handle = 'source',
) {
  const from = await node(page, id)
    .locator(`.react-flow__handle[data-handleid="${handle}"]`)
    .boundingBox();
  const pane = await page.locator('.canvas-wrap').boundingBox();
  const point = target ?? { x: pane!.x + pane!.width - 190, y: pane!.y + 95 };
  await page.mouse.move(from!.x + from!.width / 2, from!.y + from!.height / 2);
  await page.mouse.down();
  await page.mouse.move(point.x, point.y, { steps: 16 });
  await page.mouse.up();
  return point;
}
test.beforeEach(async ({ page, request }) => {
  await request.post('/api/reset', { data: {} });
  await page.goto('/');
  await page.evaluate(() => document.fonts.ready.then(() => undefined));
  await expect(page.locator('.resource-card')).toHaveCount(5);
  await expect(page.locator('.fabric-photo')).toHaveCount(5);
  await expect(page.locator('.rope-photo')).toHaveCount(6);
  await expect
    .poll(() => page.locator('.react-flow__viewport').getAttribute('style'))
    .not.toMatch(/translate\(0px, 0px\) scale\(1\)/);
});

test('shows resource properties on cards, selects the native tree target, and has no edit buttons or property webview', async ({
  page,
  request,
}) => {
  const failures: string[] = [];
  page.on('pageerror', (error) => failures.push(error.message));
  await expect(
    page.locator('iframe,.inspector,.properties-surface,.schema-field,.node-edit'),
  ).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Edit (service|resource)/ })).toHaveCount(0);
  const api = node(page, 'services/api');
  await expect(api.locator('.node-properties')).toContainText('working_dir');
  await expect(api.locator('.node-properties')).toContainText('/app');
  await api.getByRole('button', { name: 'Show all 5 properties' }).click();
  await expect(api.locator('.node-properties')).toContainText('networks');
  await expect(api.locator('.node-properties')).toContainText('backend');
  await api.locator('.node-heading').click();
  await expect.poll(async () => (await state(request)).selected).toBe('services/api');
  expect(failures).toEqual([]);
  await mkdir('artifacts', { recursive: true });
  await page.screenshot({ path: 'artifacts/compose-studio.png' });
});

test('connections are curves and can be bent, persisted, and reset', async ({ page }) => {
  const edge = page.locator('.react-flow__edge[data-id="services/gateway->services/api"]');
  const path = edge.locator('.react-flow__edge-path');
  const before = await path.getAttribute('d');
  expect(before).toContain('C');
  expect(before).not.toContain(' L');
  await edge.locator('.react-flow__edge-textwrapper').click();
  const handle = page.getByRole('button', { name: 'Bend connection' });
  await expect(handle).toBeVisible();
  const photograph = edge.locator('.rope-photo');
  await expect(photograph).toBeVisible();
  const originalTexture = await photograph.getAttribute('href');
  expect(originalTexture).toMatch(/^data:image\/png/);
  const box = await handle.boundingBox();
  await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
  await page.mouse.down();
  await page.mouse.move(box!.x + 100, box!.y - 65, { steps: 12 });
  await page.mouse.up();
  await expect.poll(() => path.getAttribute('d')).not.toBe(before);
  await expect(photograph).toBeVisible();
  await expect.poll(() => photograph.getAttribute('href')).not.toBe(originalTexture);
  const bent = await path.getAttribute('d');
  await page.reload();
  await expect.poll(() => path.getAttribute('d')).toBe(bent);
  await edge.focus();
  await edge.press('Enter');
  await page.getByRole('button', { name: 'Bend connection' }).dblclick();
  await expect.poll(() => path.getAttribute('d')).toBe(before);
});

test('moving a card keeps its connections live and restores their texture after release', async ({
  page,
}) => {
  const api = node(page, 'services/api');
  const edge = page.locator('.react-flow__edge[data-id="services/gateway->services/api"]');
  const path = edge.locator('.react-flow__edge-path');
  const before = await path.getAttribute('d');
  const heading = (await api.locator('.node-heading').boundingBox())!;
  const x = heading.x + heading.width / 2;
  const y = heading.y + heading.height / 2;
  await page.mouse.move(x, y);
  await page.mouse.down();
  await page.mouse.move(x + 65, y + 35, { steps: 12 });
  await expect(path).not.toHaveAttribute('d', before!);
  await expect(edge.locator('.rope-photo')).toHaveCount(0);
  await expect(page.locator('.rope-photo')).not.toHaveCount(0);
  await page.mouse.up();
  await expect(edge.locator('.rope-photo')).toBeVisible();
  const movedPath = await path.getAttribute('d');
  await page.reload();
  await expect(path).toHaveAttribute('d', movedPath!);
});

test('photographic rope can be sampled from a separate VS Code resource origin', async ({
  page,
}) => {
  await page.route('http://localhost:4173/**', async (route) => {
    const response = await route.fetch({
      url: route.request().url().replace('localhost', '127.0.0.1'),
    });
    await route.fulfill({
      response,
      headers: { ...response.headers(), 'access-control-allow-origin': '*' },
    });
  });
  await page.route('http://127.0.0.1:4173/', async (route) => {
    const response = await route.fetch();
    const html = (await response.text()).replace(
      'src="/dist/webview.js"',
      'src="http://localhost:4173/dist/webview.js"',
    );
    await route.fulfill({ response, body: html });
  });
  await page.goto('/');
  await expect(page.locator('.rope-photo')).toHaveCount(6);
  await expect(page.locator('.fabric-photo')).toHaveCount(5);
  await expect(page.locator('.rope-photo').first()).toHaveAttribute('href', /^data:image\/png/);
});

test('all resource kinds have distinct textiles and frayed selection excludes transparent corners', async ({
  page,
  request,
}) => {
  const textileStack = `name: textiles
services:
  api:
    image: node:alpine
    depends_on: [database]
    networks: [backend]
    volumes: [storage:/data]
    secrets: [token]
    configs: [settings]
    models: [language]
  database:
    image: postgres:alpine
jobs:
  batch:
    image: python:slim
    triggers: {manual: true}
    networks: [backend]
networks:
  backend: {driver: bridge}
volumes:
  storage: {}
secrets:
  token: {file: ./token}
configs:
  settings: {file: ./settings.conf}
models:
  language: {model: ai/smollm2}
`;
  await request.post('/api/reset', { data: { text: textileStack } });
  await page.reload();
  await expect(page.locator('.fabric-photo')).toHaveCount(8);
  await expect(page.locator('.rope-photo')).toHaveCount(7);
  const kinds = ['configs', 'jobs', 'models', 'networks', 'secrets', 'services', 'volumes'];
  expect(
    await page
      .locator('.resource-card')
      .evaluateAll((cards) =>
        [...new Set(cards.map((card) => card.getAttribute('data-material')))].sort(),
      ),
  ).toEqual(kinds);
  expect(
    await page
      .locator('.rope-photo')
      .evaluateAll((ropes) =>
        [...new Set(ropes.map((rope) => rope.getAttribute('data-material')))].sort(),
      ),
  ).toEqual(kinds);
  const photos = await page
    .locator('.fabric-photo')
    .evaluateAll((images) => images.map((image) => image.getAttribute('src')));
  expect(new Set(photos).size).toBeGreaterThanOrEqual(7);
  const api = node(page, 'services/api');
  await api.locator('.node-heading').click();
  await expect.poll(async () => (await state(request)).selected).toBe('services/api');
  await expect(api.locator('.resource-card')).toHaveCSS('box-shadow', 'none');
  await expect(api.locator('.fabric-surface')).not.toHaveCSS('filter', 'none');
  const shape = await api.locator('.resource-card').boundingBox();
  await page.mouse.click(shape!.x + 0.5, shape!.y + 0.5);
  await expect.poll(async () => (await state(request)).selected).toBe('@project');
  await api.getByRole('button', { name: 'Show all 6 properties' }).click();
  await expect
    .poll(() =>
      api.locator('.fabric-photo').evaluate(async (element) => {
        const image = element as HTMLImageElement;
        await image.decode();
        return image.naturalHeight === image.parentElement!.parentElement!.offsetHeight * 2;
      }),
    )
    .toBe(true);
  const alphaAtHandle = await api.locator('.resource-card').evaluate(async (card) => {
    const image = card.querySelector<HTMLImageElement>('.fabric-photo')!;
    await image.decode();
    const handle = card.querySelector('[data-handleid="source-left"]')!.getBoundingClientRect();
    const bounds = image.getBoundingClientRect();
    const canvas = document.createElement('canvas');
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext('2d')!;
    context.drawImage(image, 0, 0);
    const x = Math.round(((handle.x + handle.width / 2 - bounds.x) / bounds.width) * canvas.width);
    const y = Math.round(
      ((handle.y + handle.height / 2 - bounds.y) / bounds.height) * canvas.height,
    );
    return context.getImageData(x, y, 1, 1).data[3];
  });
  expect(alphaAtHandle).toBeGreaterThan(0);
  expect((await state(request)).text).toBe(textileStack);
});

for (const handle of ['source', 'source-left'])
  test(`dropping an arrow from ${handle} creates a connected network at the drop point`, async ({
    page,
    request,
  }) => {
    const point = await dropArrow(page, 'services/api', undefined, handle);
    const menu = page.getByRole('menu', { name: 'Add connected resource' });
    await expect(menu).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Add network', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Add volume', exact: true })).toBeVisible();
    await expect(menu.getByRole('menuitem', { name: 'Add job', exact: true })).toHaveCount(0);
    await menu.getByRole('menuitem', { name: 'Add network', exact: true }).click();
    await expect(page.locator('.create-dialog')).toContainText('Connect from api');
    await page.getByLabel('NAME', { exact: true }).fill('private');
    await page
      .locator('.create-dialog')
      .getByRole('button', { name: 'Add network', exact: true })
      .click();
    await expect(page.locator('.resource-card')).toHaveCount(6);
    await expect
      .poll(async () => (await state(request)).model.services.api.networks)
      .toEqual(['backend', 'private']);
    const created = await node(page, 'networks/private').boundingBox();
    expect(Math.abs(created!.x + created!.width / 2 - point.x)).toBeLessThan(70);
    await expect(
      page.locator('.react-flow__edge[data-id="services/api->networks/private"]'),
    ).toBeVisible();
  });

test('drop-created volumes include a mount path and creation plus connection undo together', async ({
  page,
  request,
}) => {
  const previous = (await state(request)).text;
  await dropArrow(page);
  await page.getByRole('menuitem', { name: 'Add volume', exact: true }).click();
  await page.getByLabel('NAME', { exact: true }).fill('uploads');
  await page.getByLabel('CONTAINER PATH').fill('/app/uploads');
  await page
    .locator('.create-dialog')
    .getByRole('button', { name: 'Add volume', exact: true })
    .click();
  await expect
    .poll(async () => (await state(request)).model.services.api.volumes?.[0])
    .toEqual({ type: 'volume', source: 'uploads', target: '/app/uploads' });
  expect((await state(request)).model.volumes.uploads).toEqual({});
  const createdSnapshot = await state(request);
  await request.post('/api/message', { data: { type: 'undo' } });
  await expect.poll(async () => (await state(request)).text).toBe(previous);
  await expect(node(page, 'volumes/uploads')).toHaveCount(0);
  await page.evaluate(async (snapshot) => {
    window.dispatchEvent(new MessageEvent('message', { data: snapshot }));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
  }, createdSnapshot);
  await expect(node(page, 'volumes/uploads')).toHaveCount(0);
});

test('cancelling a dropped connection or the creation dialog leaves YAML untouched', async ({
  page,
  request,
}) => {
  const previous = (await state(request)).text;
  await dropArrow(page);
  await page.keyboard.press('Escape');
  await expect(page.getByRole('menu', { name: 'Add connected resource' })).toHaveCount(0);
  expect((await state(request)).text).toBe(previous);
  await dropArrow(page);
  await page.getByRole('menuitem', { name: 'Add service', exact: true }).click();
  await page.getByLabel('NAME', { exact: true }).fill('worker');
  await page.getByRole('button', { name: 'Cancel', exact: true }).click();
  expect((await state(request)).text).toBe(previous);
  await expect(page.locator('.resource-card')).toHaveCount(5);
});

test('connecting an existing volume opens its mount dialog instead of the add-resource menu', async ({
  page,
  request,
}) => {
  const target = await node(page, 'volumes/pgdata')
    .locator('.react-flow__handle[data-handleid=target]')
    .boundingBox();
  await dropArrow(page, 'services/api', {
    x: target!.x + target!.width / 2,
    y: target!.y + target!.height / 2,
  });
  await expect(page.getByRole('menu', { name: 'Add connected resource' })).toHaveCount(0);
  await page.getByLabel('CONTAINER PATH').fill('/app/data');
  await page.getByRole('button', { name: 'Connect volume', exact: true }).click();
  await expect
    .poll(async () => (await state(request)).model.services.api.volumes?.[0]?.source)
    .toBe('pgdata');
  await expect(page.locator('.resource-card')).toHaveCount(5);
});

test('left handles connect to either side with the dragged direction and Compose rules preserved', async ({
  page,
  request,
}) => {
  await request.post('/api/reset', {
    data: {
      text: 'services:\n  api:\n    image: node:alpine\n  worker:\n    image: node:alpine\nnetworks:\n  private: {}\n',
    },
  });
  await page.reload();
  await expect(page.locator('.resource-card')).toHaveCount(3);
  await expect
    .poll(() => page.locator('.react-flow__viewport').getAttribute('style'))
    .not.toMatch(/translate\(0px, 0px\) scale\(1\)/);
  const target = await node(page, 'services/worker')
    .locator('.connection-handle[data-handleid=source]')
    .boundingBox();
  await dropArrow(
    page,
    'services/api',
    {
      x: target!.x + target!.width / 2,
      y: target!.y + target!.height / 2,
    },
    'source-left',
  );
  await expect
    .poll(async () => (await state(request)).model.services.api.depends_on)
    .toEqual(['worker']);
  expect((await state(request)).model.services.worker.depends_on).toBeUndefined();

  const network = node(page, 'networks/private');
  const networkHandle = await network
    .locator('.connection-handle[data-handleid=target-right]')
    .boundingBox();
  await dropArrow(
    page,
    'services/api',
    {
      x: networkHandle!.x + networkHandle!.width / 2,
      y: networkHandle!.y + networkHandle!.height / 2,
    },
    'source-left',
  );
  await expect
    .poll(async () => (await state(request)).model.services.api.networks)
    .toEqual(['private']);
  await expect(page.getByRole('menu', { name: 'Add connected resource' })).toHaveCount(0);
  await expect(network.locator('.connection-handle.connectablestart')).toHaveCount(0);

  const previous = (await state(request)).text;
  const api = await node(page, 'services/api')
    .locator('.connection-handle[data-handleid=source]')
    .boundingBox();
  await dropArrow(
    page,
    'services/worker',
    {
      x: api!.x + api!.width / 2,
      y: api!.y + api!.height / 2,
    },
    'source-left',
  );
  await expect(page.getByRole('menu', { name: 'Add connected resource' })).toHaveCount(0);
  expect((await state(request)).text).toBe(previous);
});

test('resource selection highlights only outgoing connections and background clears the focus without editing YAML', async ({
  page,
  request,
}) => {
  const previous = (await state(request)).text;
  const api = node(page, 'services/api');
  const outgoing = page.locator('.react-flow__edge[data-id^="services/api->"]');
  const incoming = page.locator('.react-flow__edge[data-id="services/gateway->services/api"]');
  await api.locator('.node-heading').click();
  await expect(outgoing).toHaveCount(2);
  await expect(outgoing.first()).toHaveClass(/is-focused/);
  await expect(outgoing.last()).toHaveClass(/is-focused/);
  await expect(outgoing.first().locator('.react-flow__edge-path')).not.toHaveCSS('filter', 'none');
  await expect(incoming).toHaveCSS('opacity', '0.3');
  await expect(api.locator('.resource-card')).toHaveClass(/is-selected/);
  await expect(node(page, 'services/gateway')).toHaveClass(/is-unrelated/);
  await expect(node(page, 'services/database')).not.toHaveClass(/is-unrelated/);

  // Native tree selections arrive through the same snapshot as this host selection.
  await request.post('/api/message', { data: { type: 'select', id: 'services/gateway' } });
  await expect(incoming).toHaveClass(/is-focused/);
  await expect(outgoing.first()).not.toHaveClass(/is-focused/);
  await page.locator('.react-flow__pane').click({ position: { x: 30, y: 30 } });
  await expect.poll(async () => (await state(request)).selected).toBe('@project');
  await expect(
    page.locator(
      '.react-flow__edge.is-focused,.react-flow__edge.is-unrelated,.react-flow__node.is-unrelated,.resource-card.is-selected',
    ),
  ).toHaveCount(0);
  await expect(incoming).toHaveCSS('opacity', '1');
  expect((await state(request)).text).toBe(previous);
});

for (const selectedImage of ['nginx:stable-alpine', undefined])
  test(`native image picker ${selectedImage ? 'selection' : 'cancellation'} updates the creation form before saving`, async ({
    page,
    request,
  }) => {
    await page.route('**/api/message', async (route) => {
      const message = route.request().postDataJSON();
      if (message.type === 'pickImage') {
        expect(message.current).toBe('node:alpine');
        await route.fulfill({
          json: [
            {
              type: 'imagePicked',
              requestId: message.requestId,
              documentId: 'preview://compose.yaml',
              image: selectedImage,
            },
          ],
        });
      } else await route.continue();
    });
    await page.getByRole('button', { name: 'Add resource', exact: true }).click();
    await page.locator('.add-menu').getByRole('button', { name: 'services', exact: true }).click();
    await page.getByLabel('NAME', { exact: true }).fill('worker');
    await page.getByLabel('CONTAINER IMAGE', { exact: true }).fill('node:alpine');
    const search = page.getByRole('button', { name: 'Search Docker Hub', exact: true });
    await search.click();
    await expect(search).toBeEnabled();
    const expected = selectedImage ?? 'node:alpine';
    await expect(page.getByLabel('CONTAINER IMAGE', { exact: true })).toHaveValue(expected);
    expect((await state(request)).model.services.worker).toBeUndefined();
    await expect(page.locator('.hub-dialog')).toHaveCount(0);
    await page.getByRole('button', { name: 'Add service', exact: true }).click();
    await expect
      .poll(async () => (await state(request)).model.services.worker.image)
      .toBe(expected);
    await expect(node(page, 'services/worker')).toContainText(expected);
  });

test('blank service creation, schema errors, and native theme colors remain usable', async ({
  page,
  request,
}) => {
  await request.post('/api/reset', { data: { text: 'services: [' } });
  await expect(page.locator('.syntax-banner')).toBeVisible();
  await expect(page.getByRole('button', { name: 'Add resource', exact: true })).toBeDisabled();
  await request.post('/api/reset', { data: { text: '# New project\nservices: {}\n' } });
  await page.getByRole('button', { name: 'Add your first service' }).click();
  await page.getByLabel('NAME', { exact: true }).fill('web');
  await page
    .locator('.create-dialog')
    .getByRole('button', { name: 'Add service', exact: true })
    .click();
  await expect(page.locator('.resource-card')).toHaveCount(1);
  expect(Object.hasOwn((await state(request)).model.services.web, 'image')).toBe(false);
  await page.evaluate(() => {
    document.documentElement.style.setProperty('--vscode-editor-background', '#ffffff');
    document.documentElement.style.setProperty('--vscode-foreground', '#333333');
  });
  expect(
    await page.evaluate(() => getComputedStyle(document.documentElement).backgroundColor),
  ).toBe('rgb(255, 255, 255)');
  await page.setViewportSize({ width: 900, height: 650 });
  const box = await page.locator('.canvas-wrap').boundingBox();
  expect(box!.width).toBeGreaterThan(850);
  expect(box!.height).toBeGreaterThan(590);
});
