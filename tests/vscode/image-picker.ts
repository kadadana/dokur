import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { pickDockerImage, type ImagePickerUI } from '../../src/image-picker';
import type { HubImage } from '../../src/protocol';

async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 5000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
}
type Picker = ReturnType<ImagePickerUI['create']>;
async function accept(picker: Picker, action: string, reference?: string) {
  const item = picker.items.find(
    (item) => item.action === action && (!reference || item.reference === reference),
  );
  assert.ok(item, `Missing ${action} / ${reference}`);
  picker.activeItems = [item];
  // Let the extension-host QuickInput update reach the workbench before accepting it.
  await new Promise((resolve) => setTimeout(resolve, 40));
  await vscode.commands.executeCommand('workbench.action.acceptSelectedQuickOpenItem');
}
const nginx: HubImage = {
  name: 'nginx',
  description: 'Web server',
  official: true,
  pulls: 1000,
  stars: 100,
};

export async function testImagePicker() {
  const pickers: Picker[] = [];
  const manualAnswers: (string | undefined)[] = [];
  const inputs: vscode.InputBoxOptions[] = [];
  const ui: ImagePickerUI = {
    create: () => {
      const picker = vscode.window.createQuickPick<any>();
      pickers.push(picker);
      return picker;
    },
    input: async (options) => {
      inputs.push(options);
      return manualAnswers.shift();
    },
  };
  const queries: string[] = [];
  const tags: string[] = [];
  const result = pickDockerImage(
    {
      search: async (query) => {
        queries.push(query);
        return [nginx];
      },
      tags: async (name) => {
        tags.push(name);
        return [
          { name: 'alpine', architectures: ['amd64', 'arm64'] },
          { name: 'latest', architectures: ['amd64'] },
        ];
      },
    },
    'old:tag',
    ui,
  );
  let picker = pickers.at(-1)!;
  picker.value = 'nginx';
  await until(() => picker.items.some((item) => item.action === 'search'), 'typed search action');
  assert.deepEqual(queries, [], 'typing must not query Docker Hub');
  await accept(picker, 'search');
  await until(() => picker.items.some((item) => item.action === 'repository'), 'search results');
  assert.deepEqual(queries, ['nginx']);
  assert.equal(picker.items.at(-1)?.action, 'manual');
  picker.value = 'redis';
  await until(
    () => picker.items.some((item) => item.action === 'search'),
    'new search from results',
  );
  assert.deepEqual(queries, ['nginx']);
  await accept(picker, 'search');
  await until(
    () => picker.items.some((item) => item.action === 'repository'),
    'replacement results',
  );
  assert.deepEqual(queries, ['nginx', 'redis']);
  await accept(picker, 'repository', 'nginx');
  await until(() => pickers.length === 2, 'tag picker');
  picker = pickers.at(-1)!;
  await until(() => picker.items.some((item) => item.reference === 'nginx:alpine'), 'tag results');
  assert.deepEqual(tags, ['nginx']);
  assert.equal(picker.items[0].reference, 'nginx:latest');
  await accept(picker, 'reference', 'nginx:alpine');
  assert.equal(await result, 'nginx:alpine');

  for (const failure of ['empty', 'offline']) {
    const pending = pickDockerImage(
      {
        search: async () => {
          if (failure === 'offline') throw new Error('offline');
          return [];
        },
        tags: async () => [],
      },
      '',
      ui,
    );
    picker = pickers.at(-1)!;
    picker.value = 'private';
    await until(
      () => picker.items.some((item) => item.action === 'search'),
      'fallback search action',
    );
    await accept(picker, 'search');
    await until(
      () =>
        !picker.busy &&
        picker.items.some((item) => /No Docker Hub results|unavailable/.test(item.label)),
      'fallback results',
    );
    assert.equal(picker.items.at(-1)?.action, 'manual');
    manualAnswers.push('  ghcr.io/acme/private:dev  ');
    await accept(picker, 'manual');
    assert.equal(await pending, 'ghcr.io/acme/private:dev');
    assert.equal(inputs.at(-1)?.value, 'private');
  }

  let complete!: (images: HubImage[]) => void;
  const delayed = pickDockerImage(
    {
      search: () =>
        new Promise((resolve) => {
          complete = resolve;
        }),
      tags: async () => [],
    },
    '',
    ui,
  );
  picker = pickers.at(-1)!;
  picker.value = 'nginx';
  await until(() => picker.items.some((item) => item.action === 'search'), 'delayed search action');
  await accept(picker, 'search');
  await until(() => !!complete, 'request started');
  picker.hide();
  assert.equal(await delayed, undefined);
  const count = pickers.length;
  complete([nginx]);
  await new Promise((resolve) => setTimeout(resolve, 30));
  assert.equal(pickers.length, count, 'cancelled request must not open another picker');

  console.log(
    'PASS: real native QuickPick Enter search, repository/tag selection, empty/offline manual fallback, and in-flight cancellation',
  );
}
