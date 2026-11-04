import * as vscode from 'vscode';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { ComposeProvider } from '../../src/extension';
import { DokurNavigator } from '../../src/navigator';
import { DokurProperties, type PropertyDialogs, type PropertyItem } from '../../src/properties';
import { testImagePicker } from './image-picker';

async function until(check: () => boolean, label: string) {
  const deadline = Date.now() + 20_000;
  while (!check()) {
    if (Date.now() > deadline) throw new Error(`Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}
function panel() {
  const messages: any[] = [];
  let listener!: (message: any) => Promise<void>;
  let dispose!: () => void;
  const value = {
    webview: {
      options: {},
      html: '',
      cspSource: 'vscode-webview://test',
      asWebviewUri: (uri: vscode.Uri) => uri,
      postMessage: async (message: any) => {
        messages.push(message);
        return true;
      },
      onDidReceiveMessage: (handler: typeof listener) => {
        listener = handler;
        return { dispose() {} };
      },
    },
    reveal() {},
    onDidDispose: (handler: () => void) => {
      dispose = handler;
      return { dispose() {} };
    },
  } as unknown as vscode.WebviewPanel;
  return { value, messages, send: (message: any) => listener(message), dispose: () => dispose() };
}

export async function run() {
  const root = process.env.DOKUR_TEST_ROOT!;
  const uri = vscode.Uri.file(join(root, '.preview', 'vscode-workspace', 'compose.yaml'));
  const extension = vscode.extensions.getExtension('kadadana.dokur');
  assert.ok(extension);
  await extension.activate();
  const commands = await vscode.commands.getCommands();
  for (const command of [
    'dokur.open',
    'dokur.new',
    'dokur.example',
    'dokur.architecture',
    'dokur.addResource',
    'dokur.selectResource',
    'dokur.projectSettings',
    'dokur.searchImages',
    'dokur.source',
    'dokur.problems',
    'dokur.format',
    'dokur.property.change',
    'dokur.property.add',
    'dokur.property.type',
    'dokur.property.remove',
    'dokur.property.image',
  ])
    assert.ok(commands.includes(command), command);
  assert.ok(!commands.includes('dokur.editResource'));
  const manifest = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  assert.notEqual(
    manifest.contributes.views.dokur.find((view: any) => view.id === 'dokur.properties').type,
    'webview',
  );
  await testImagePicker();
  const document = await vscode.workspace.openTextDocument(uri);
  await vscode.window.showTextDocument(document);
  const imageAnswers: (string | undefined)[] = [];
  let imageChoice: (current?: string) => Promise<string | undefined> = async () =>
    imageAnswers.shift();
  const provider = new ComposeProvider(
    {
      extensionUri: vscode.Uri.file(root),
    } as vscode.ExtensionContext,
    (current) => imageChoice(current),
  );
  provider.revealProperties = async () => {};
  const graph = panel();
  await provider.resolveCustomTextEditor(document, graph.value);
  await graph.send({ type: 'ready' });
  assert.ok(graph.value.webview.html.includes("connect-src 'none'"));
  assert.ok(/script nonce="[A-Za-z0-9+/=]+"/.test(graph.value.webview.html));
  let version = document.version;
  await graph.send({
    type: 'edit',
    version,
    operation: { type: 'set', path: ['services', 'api', 'image'], value: 'node:24-alpine' },
  });
  assert.ok(document.getText().includes('node:24-alpine'));
  assert.ok(document.isDirty);
  assert.ok(document.getText().includes('# integration fixture'));
  await graph.send({
    type: 'edit',
    version,
    operation: { type: 'set', path: ['name'], value: 'stale' },
  });
  assert.ok(
    graph.messages.some(
      (message) => message.type === 'error' && message.message.includes('document changed'),
    ),
  );
  await graph.send({ type: 'undo' });
  await until(() => document.getText().includes('node:22-alpine'), 'undo');
  await graph.send({ type: 'redo' });
  await until(() => document.getText().includes('node:24-alpine'), 'redo');
  await graph.send({ type: 'save' });
  assert.equal(document.isDirty, false);
  version = document.version;
  await Promise.all([
    graph.send({
      type: 'edit',
      version,
      operation: { type: 'set', path: ['name'], value: 'first' },
    }),
    graph.send({
      type: 'edit',
      version,
      operation: { type: 'set', path: ['name'], value: 'second' },
    }),
  ]);
  assert.ok(document.getText().includes('first'));
  assert.ok(!document.getText().includes('second'));
  await document.save();
  console.log('PASS: actual VS Code document, save, undo/redo, version conflicts, and edit queue');

  const answers: string[] = [];
  const picks: string[] = [];
  const ui: PropertyDialogs = {
    input: async (options) => {
      const answer = answers.shift();
      if (answer !== undefined)
        assert.equal(await options.validateInput?.(answer), undefined, `Input rejected: ${answer}`);
      return answer;
    },
    pick: async <T extends vscode.QuickPickItem>(items: T[]) => {
      const label = picks.shift();
      if (label === undefined) return undefined;
      const item = items.find((item) => item.label === label);
      assert.ok(item, `Missing quick pick ${label}: ${items.map((item) => item.label).join(', ')}`);
      return item;
    },
  };
  const properties = new DokurProperties(
    () => provider.currentSnapshot(),
    (op, id, version) => provider.applyNative(op, id, version),
    (path) => provider.searchImages(path),
    ui,
  );
  const item = (path: (string | number)[], type: PropertyItem['type'] = 'value'): PropertyItem => ({
    type,
    path,
    documentId: uri.toString(),
    version: document.version,
  });
  await provider.selectResource('services/api', document, false);
  let children = properties.getChildren(properties.root());
  assert.ok(children.some((child) => child.path.at(-1) === 'image'));
  assert.equal(
    properties.getTreeItem(children.find((child) => child.path.at(-1) === 'image')!).contextValue,
    'dokur.imageProperty',
  );
  assert.equal(
    properties.getTreeItem(children.find((child) => child.path.at(-1) === 'image')!).command
      ?.command,
    'dokur.property.image',
  );
  await properties.remove(item(['services', 'api', 'image']));
  assert.ok(!Object.hasOwn(provider.currentSnapshot()!.model.services.api, 'image'));
  children = properties.getChildren(properties.root());
  const missingImage = children.find((child) => child.path.at(-1) === 'image')!;
  assert.equal(properties.getTreeItem(missingImage).description, 'Not set');
  answers.push('node:alpine');
  await properties.change(missingImage);
  assert.ok(document.getText().includes('    image: node:alpine'));
  picks.push('environment', 'object');
  await properties.add(properties.root()!);
  picks.push('Custom key / x- extension…', 'number');
  answers.push('PORT', '3000');
  await properties.add(item(['services', 'api', 'environment']));
  assert.equal(provider.currentSnapshot()!.model.services.api.environment.PORT, 3000);
  assert.equal(
    properties.getTreeItem(item(['services', 'api', 'environment', 'PORT'])).description,
    '3000',
  );
  picks.push('ports');
  await properties.add(properties.root()!);
  picks.push('string');
  answers.push('8080:80');
  await properties.add(item(['services', 'api', 'ports']));
  assert.deepEqual(provider.currentSnapshot()!.model.services.api.ports, ['8080:80']);
  picks.push('string');
  answers.push('${PORT:-3000}');
  await properties.change(item(['services', 'api', 'environment', 'PORT']), true);
  assert.equal(provider.currentSnapshot()!.model.services.api.environment.PORT, '${PORT:-3000}');
  const beforeCancel = document.getText();
  await properties.change(item(['services', 'api', 'image']));
  assert.equal(document.getText(), beforeCancel);
  const navigator = new DokurNavigator(() => provider.currentSnapshot(), vscode.Uri.file(root));
  assert.ok(
    navigator
      .getChildren({ type: 'kind', kind: 'services' })
      .some((item) => item.type === 'resource' && item.name === 'api'),
  );
  answers.push('backend');
  await properties.rename(properties.root()!);
  assert.equal(provider.currentSnapshot()!.selected, 'services/backend');
  assert.ok(
    navigator
      .getChildren({ type: 'kind', kind: 'services' })
      .some((item) => item.type === 'resource' && item.name === 'backend'),
  );
  imageAnswers.push('ghcr.io/acme/backend:dev');
  await properties.image(item(['services', 'backend', 'image']));
  assert.equal(
    provider.currentSnapshot()!.model.services.backend.image,
    'ghcr.io/acme/backend:dev',
  );
  const beforeImageCancel = document.getText();
  await properties.image(item(['services', 'backend', 'image']));
  assert.equal(document.getText(), beforeImageCancel);
  imageAnswers.push('nginx:alpine');
  await graph.send({ type: 'pickImage', requestId: 'draft-image', current: '' });
  assert.equal(graph.messages.at(-1).type, 'imagePicked');
  assert.equal(graph.messages.at(-1).requestId, 'draft-image');
  assert.equal(graph.messages.at(-1).image, 'nginx:alpine');
  assert.equal(
    document.getText(),
    beforeImageCancel,
    'draft image selection must not edit the file',
  );
  let resolveImage!: (value: string | undefined) => void;
  imageChoice = () =>
    new Promise((resolve) => {
      resolveImage = resolve;
    });
  const staleImage = properties.image(item(['services', 'backend', 'image']));
  await provider.applyNative(
    { type: 'set', path: ['name'], value: 'changed-during-image-search' },
    uri.toString(),
    document.version,
  );
  resolveImage('wrong:stale');
  await assert.rejects(staleImage, /document changed/);
  assert.equal(
    provider.currentSnapshot()!.model.services.backend.image,
    'ghcr.io/acme/backend:dev',
  );
  imageChoice = async () => imageAnswers.shift();
  const beforeConnected = document.getText();
  await provider.applyNative(
    {
      type: 'createConnected',
      sourceKind: 'services',
      source: 'backend',
      targetKind: 'networks',
      name: 'private',
      value: {},
    },
    uri.toString(),
    document.version,
  );
  assert.deepEqual(provider.currentSnapshot()!.model.services.backend.networks, ['private']);
  assert.ok(provider.currentSnapshot()!.model.networks.private);
  await graph.send({ type: 'undo' });
  await until(() => document.getText() === beforeConnected, 'atomic creation undo');
  await graph.send({ type: 'redo' });
  await until(() => !!provider.currentSnapshot()!.model.networks.private, 'atomic creation redo');
  await document.save();
  console.log(
    'PASS: native nested properties, types, maps, arrays, optional image, rename, cancellation, Hub action, atomic create/connect undo',
  );

  const legacy = '# legacy file\nservices: {backend: {image: node:alpine}}\n';
  const legacyEdit = new vscode.WorkspaceEdit();
  legacyEdit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), legacy);
  await vscode.workspace.applyEdit(legacyEdit);
  await document.save();
  await provider.formatYaml(document);
  assert.equal(
    document.getText(),
    '# legacy file\nservices:\n  backend:\n    image: node:alpine\n',
  );
  await graph.send({ type: 'undo' });
  await until(() => document.getText() === legacy, 'format undo');
  await graph.send({ type: 'redo' });
  await until(() => document.getText().includes('    image: node:alpine'), 'format redo');
  await document.save();
  const stale = item(['services', 'backend', 'image']);
  imageChoice = () =>
    new Promise((resolve) => {
      resolveImage = resolve;
    });
  const wrongFileImage = provider.searchImages(['services', 'backend', 'image']);
  const otherUri = vscode.Uri.file(
    join(root, '.preview', 'vscode-workspace', 'other-compose.yaml'),
  );
  await writeFile(otherUri.fsPath, 'name: other\nservices: {}\n');
  const other = await vscode.workspace.openTextDocument(otherUri);
  const otherGraph = panel();
  await provider.resolveCustomTextEditor(other, otherGraph.value);
  resolveImage('wrong:file');
  await assert.rejects(wrongFileImage, /active Compose file changed/);
  await assert.rejects(properties.change(stale), /Compose file changed/);
  await assert.rejects(
    provider.applyNative(
      { type: 'set', path: ['name'], value: 'wrong-file' },
      uri.toString(),
      other.version,
    ),
    /active Compose file changed/,
  );
  assert.equal(other.getText(), 'name: other\nservices: {}\n');
  otherGraph.dispose();
  graph.dispose();
  properties.dispose();
  navigator.dispose();
  provider.dispose();
  console.log('PASS: block YAML format and undo, stale native item and wrong-file guards');

  const invalid = 'services:\n  web:\n    image: nginx\n    networks: [missing]\n';
  const edit = new vscode.WorkspaceEdit();
  edit.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), invalid);
  await vscode.workspace.applyEdit(edit);
  await document.save();
  await vscode.commands.executeCommand('dokur.open', uri);
  await vscode.commands.executeCommand('dokur.selectResource', 'services/web');
  await vscode.commands.executeCommand('dokur.properties.focus');
  await until(
    () => vscode.languages.getDiagnostics(uri).some((d) => d.source === 'Dokur reference'),
    'real editor diagnostics',
  );
  assert.ok(
    vscode.window.tabGroups.all.some((group) =>
      group.tabs.some(
        (tab) =>
          tab.input instanceof vscode.TabInputCustom && tab.input.viewType === 'dokur.compose',
      ),
    ),
  );
  const fix = new vscode.WorkspaceEdit();
  fix.insert(uri, document.positionAt(document.getText().length), 'networks:\n  missing: {}\n');
  await vscode.workspace.applyEdit(fix);
  await until(
    () => !vscode.languages.getDiagnostics(uri).some((d) => d.source?.startsWith('Dokur')),
    'external YAML synchronization',
  );
  await document.save();
  await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  await writeFile(
    join(root, 'artifacts', 'vscode-test-result.json'),
    JSON.stringify(
      {
        passed: true,
        vscode: vscode.version,
        checks: [
          'native-properties-tree',
          'no-properties-webview',
          'nested-map-and-array-editing',
          'optional-image',
          'native-hub-enter-search',
          'hub-empty-and-offline-manual-fallback',
          'image-picker-document-guards',
          'schema-types',
          'rename',
          'cancel-input',
          'stale-document-guard',
          'atomic-connected-creation-undo',
          'format-undo',
          'save',
          'undo-redo',
          'edit-queue',
          'custom-editor',
          'external-YAML-sync',
          'diagnostics',
        ],
      },
      null,
      2,
    ),
  );
  console.log(
    'PASS: real custom editor, native TreeView registration and focus, diagnostics, external source synchronization',
  );
  if (process.env.DOKUR_VISUAL_QA) {
    const sample = await readFile(join(root, 'examples', 'compose.yaml'), 'utf8');
    const preview = new vscode.WorkspaceEdit();
    preview.replace(uri, new vscode.Range(0, 0, document.lineCount, 0), sample);
    await vscode.workspace.applyEdit(preview);
    await document.save();
    await vscode.commands.executeCommand('dokur.open', uri);
    await vscode.commands.executeCommand('dokur.selectResource', 'services/api');
    const control = join(root, '.preview', 'visual-qa-control');
    await writeFile(control, 'ready');
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline && (await readFile(control, 'utf8')) !== 'done')
      await new Promise((resolve) => setTimeout(resolve, 250));
    await vscode.commands.executeCommand('workbench.action.closeAllEditors');
  }
}
