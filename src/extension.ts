import * as vscode from 'vscode';
import { randomBytes } from 'node:crypto';
import { readCompose, applyOperation } from './document';
import { isOperation, type HostMessage, type Snapshot, type Operation } from './protocol';
import { DockerHub } from './hub';
import { at, resourceKinds, type Path } from './schema';
import { pickDockerImage } from './image-picker';
import { DokurNavigator, type NavigatorItem } from './navigator';
import { DokurProperties, type PropertyItem } from './properties';

const viewType = 'dokur.compose';
type UIAction = Extract<HostMessage, { type: 'ui' }>;
type Session = { document: vscode.TextDocument; panel: vscode.WebviewPanel; ready: boolean };

export function activate(context: vscode.ExtensionContext) {
  const provider = new ComposeProvider(context);
  const navigator = new DokurNavigator(() => provider.currentSnapshot(), context.extensionUri);
  const tree = vscode.window.createTreeView('dokur.navigator', { treeDataProvider: navigator });
  const properties = new DokurProperties(
    () => provider.currentSnapshot(),
    (operation, documentId, version) => provider.applyNative(operation, documentId, version),
    (path) => provider.searchImages(path),
  );
  const propertyTree = vscode.window.createTreeView('dokur.properties', {
    treeDataProvider: properties,
  });
  provider.revealProperties = async () => {
    const root = properties.root();
    if (root) await propertyTree.reveal(root, { focus: false, select: false, expand: true });
  };
  const status = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Right, 80);
  status.command = 'dokur.problems';
  const refresh = () => {
    navigator.refresh();
    properties.refresh();
    const snapshot = provider.currentSnapshot();
    if (!snapshot) {
      status.hide();
      return;
    }
    const count = snapshot.issues.length;
    status.text = count ? `$(warning) Compose: ${count}` : '$(check) Compose';
    status.tooltip = count
      ? `${count} Compose problems`
      : 'Compose schema and local references are valid';
    status.show();
  };
  context.subscriptions.push(
    provider,
    navigator,
    tree,
    status,
    properties,
    propertyTree,
    provider.onDidChange(refresh),
    vscode.window.registerCustomEditorProvider(viewType, provider, {
      webviewOptions: { retainContextWhenHidden: true },
      supportsMultipleEditorsPerDocument: true,
    }),
  );
  const command = (name: string, handler: (...args: any[]) => any) =>
    context.subscriptions.push(
      vscode.commands.registerCommand(name, async (...args: any[]) => {
        try {
          return await handler(...args);
        } catch (error) {
          await vscode.window.showErrorMessage((error as Error).message);
        }
      }),
    );
  command('dokur.open', async (uri?: vscode.Uri) => {
    uri ??= vscode.window.activeTextEditor?.document.uri;
    if (!uri)
      uri = (
        await vscode.window.showOpenDialog({
          canSelectMany: false,
          filters: { YAML: ['yml', 'yaml'] },
        })
      )?.[0];
    if (uri) {
      await vscode.commands.executeCommand('vscode.openWith', uri, viewType);
      await vscode.commands.executeCommand('workbench.view.extension.dokur');
    }
  });
  command('dokur.architecture', () => provider.revealCanvas());
  command('dokur.selectResource', (id: string) => provider.selectResource(id));
  command('dokur.projectSettings', () => provider.selectResource('@project'));
  command('dokur.addResource', async (item?: NavigatorItem) => {
    let kind = item?.type === 'kind' ? item.kind : undefined;
    if (!kind)
      kind = await vscode.window.showQuickPick(resourceKinds, {
        title: 'Add a Compose resource',
        placeHolder: 'Resource type',
      });
    if (kind) await provider.runInCanvas({ type: 'ui', action: 'create', kind });
  });
  command('dokur.searchImages', () => provider.searchImages());
  command('dokur.source', () => provider.openSource());
  command('dokur.format', () => provider.formatYaml());
  command('dokur.property.change', (item: PropertyItem) => properties.change(item));
  command('dokur.property.add', (item?: PropertyItem) => {
    const target = item ?? properties.root();
    if (target) return properties.add(target);
  });
  command('dokur.property.type', (item: PropertyItem) => properties.change(item, true));
  command('dokur.property.remove', (item: PropertyItem) => properties.remove(item));
  command('dokur.property.rename', (item: PropertyItem) => properties.rename(item));
  command('dokur.property.image', (item: PropertyItem) => properties.image(item));
  command('dokur.problems', () =>
    vscode.commands.executeCommand('workbench.actions.view.problems'),
  );
  command('dokur.refresh', () => navigator.refreshFiles());
  async function create(example = false) {
    const root = vscode.workspace.workspaceFolders?.[0]?.uri;
    const uri = await vscode.window.showSaveDialog({
      defaultUri: root ? vscode.Uri.joinPath(root, 'compose.yaml') : undefined,
      filters: { YAML: ['yaml', 'yml'] },
      saveLabel: 'Create Compose file',
    });
    if (!uri) return;
    const content = example
      ? await vscode.workspace.fs.readFile(
          vscode.Uri.joinPath(context.extensionUri, 'examples', 'compose.yaml'),
        )
      : Buffer.from('# Created with Docker Compose Studio\nname: my-project\nservices: {}\n');
    await vscode.workspace.fs.writeFile(uri, content);
    await vscode.commands.executeCommand('dokur.open', uri);
    await navigator.refreshFiles();
  }
  command('dokur.new', () => create());
  command('dokur.example', () => create(true));
}

export class ComposeProvider implements vscode.CustomTextEditorProvider, vscode.Disposable {
  private hub = new DockerHub();
  private diagnostics = vscode.languages.createDiagnosticCollection('dokur');
  private queues = new Map<string, Promise<void>>();
  private sessions = new Set<Session>();
  private selections = new Map<string, string>();
  private pendingActions = new Map<string, UIAction[]>();
  revealProperties?: () => Promise<void>;
  private activeDocument?: vscode.TextDocument;
  private changed = new vscode.EventEmitter<void>();
  readonly onDidChange = this.changed.event;
  private disposables: vscode.Disposable[];
  private chooseImage: (current?: string) => Promise<string | undefined>;
  constructor(
    private context: vscode.ExtensionContext,
    chooseImage?: (current?: string) => Promise<string | undefined>,
  ) {
    this.chooseImage = chooseImage ?? ((current) => pickDockerImage(this.hub, current));
    this.disposables = [
      vscode.workspace.onDidChangeTextDocument((event) => {
        if (
          [...this.sessions].some((session) => session.document === event.document) ||
          this.activeDocument === event.document
        )
          this.push(event.document);
      }),
      vscode.workspace.onDidSaveTextDocument((document) => {
        if (
          [...this.sessions].some((session) => session.document === document) ||
          this.activeDocument === document
        )
          this.push(document);
      }),
      vscode.window.onDidChangeActiveTextEditor((editor) => {
        if (editor && this.selections.has(editor.document.uri.toString()))
          this.setActive(editor.document);
      }),
      vscode.workspace.onDidCloseTextDocument((document) => {
        if (document === this.activeDocument) {
          this.activeDocument = undefined;
          this.changed.fire();
        }
      }),
    ];
  }
  dispose() {
    this.disposables.forEach((item) => item.dispose());
    this.diagnostics.dispose();
    this.changed.dispose();
  }
  currentSnapshot(): Snapshot | undefined {
    return this.activeDocument && !this.activeDocument.isClosed
      ? this.snapshot(this.activeDocument)
      : undefined;
  }
  private snapshot(document: vscode.TextDocument): Snapshot {
    const parsed = readCompose(document.getText());
    const documentId = document.uri.toString();
    const id = this.selections.get(documentId) ?? '@project';
    const [kind, name] = id.split('/');
    const selected =
      id === '@project' || Object.hasOwn(parsed.model[kind] ?? {}, name) ? id : '@project';
    return {
      type: 'snapshot',
      text: document.getText(),
      model: parsed.model,
      issues: parsed.issues,
      editable: parsed.editable,
      version: document.version,
      filename: document.uri.path.split('/').at(-1) ?? 'compose.yaml',
      dirty: document.isDirty,
      documentId,
      selected,
    };
  }
  private push(document: vscode.TextDocument) {
    if (document.isClosed) return;
    const state = this.snapshot(document);
    this.diagnostics.set(
      document.uri,
      state.issues.slice(0, 200).map((issue) => {
        const line = Math.max(0, (issue.line ?? 1) - 1);
        const diagnostic = new vscode.Diagnostic(
          new vscode.Range(
            line,
            Math.max(0, (issue.column ?? 1) - 1),
            line,
            Math.max(1, issue.column ?? 1),
          ),
          `${issue.path.join('.') || 'compose'}: ${issue.message}`,
          issue.severity === 'error'
            ? vscode.DiagnosticSeverity.Error
            : vscode.DiagnosticSeverity.Warning,
        );
        diagnostic.source = `Dokur ${issue.source}`;
        return diagnostic;
      }),
    );
    for (const session of this.sessions)
      if (session.document === document && session.ready)
        void session.panel.webview.postMessage(state);
    if (this.activeDocument === document) {
      this.changed.fire();
    }
  }
  private setActive(document: vscode.TextDocument) {
    this.activeDocument = document;
    if (!this.selections.has(document.uri.toString()))
      this.selections.set(document.uri.toString(), '@project');
    this.push(document);
  }
  async revealCanvas() {
    const document = this.activeDocument;
    if (!document) {
      await vscode.commands.executeCommand('dokur.open');
      return;
    }
    const session = [...this.sessions].find((item) => item.document === document);
    if (session) session.panel.reveal(undefined, true);
    else await vscode.commands.executeCommand('vscode.openWith', document.uri, viewType);
  }
  async selectResource(id: string, document = this.activeDocument, show = true) {
    if (!document || typeof id !== 'string') return;
    const state = this.snapshot(document);
    const [kind, name] = id.split('/');
    if (
      id !== '@project' &&
      (!resourceKinds.includes(kind) || !Object.hasOwn(state.model[kind] ?? {}, name))
    )
      return;
    this.selections.set(document.uri.toString(), id);
    this.setActive(document);
    if (show) {
      if (this.revealProperties) await this.revealProperties();
      else await vscode.commands.executeCommand('dokur.properties.focus');
    }
  }
  async runInCanvas(action: UIAction) {
    const document = this.activeDocument;
    if (!document) {
      await vscode.window.showInformationMessage('Open a Compose file first.');
      return;
    }
    await this.revealCanvas();
    const session = [...this.sessions].find((item) => item.document === document);
    if (session?.ready)
      await session.panel.webview.postMessage({ ...action, documentId: document.uri.toString() });
    else {
      const key = document.uri.toString();
      this.pendingActions.set(key, [...(this.pendingActions.get(key) ?? []), action]);
    }
  }
  async searchImages(path?: Path) {
    const state = this.currentSnapshot();
    if (!state) {
      await vscode.window.showInformationMessage('Open a Compose file first.');
      return;
    }
    if (!path) {
      const [kind, name] = (state.selected ?? '').split('/');
      if (['services', 'jobs'].includes(kind) && Object.hasOwn(state.model[kind] ?? {}, name))
        path = [kind, name, 'image'];
      else {
        const choices = ['services', 'jobs'].flatMap((kind) =>
          Object.keys(state.model[kind] ?? {}).map((name) => ({
            label: name,
            description: kind,
            resourceKind: kind,
          })),
        );
        if (!choices.length) {
          await vscode.window.showInformationMessage('Add a service before choosing its image.');
          return;
        }
        const picked = await vscode.window.showQuickPick(choices, {
          title: 'Choose a service for the Docker Hub image',
        });
        if (!picked) return;
        path = [picked.resourceKind, picked.label, 'image'];
      }
    }
    if (
      path.length !== 3 ||
      !['services', 'jobs'].includes(String(path[0])) ||
      path[2] !== 'image' ||
      !Object.hasOwn(state.model[String(path[0])] ?? {}, String(path[1]))
    )
      throw new Error('Select the image property of a service or job.');
    if (!state.editable) throw new Error('Fix the YAML syntax before choosing an image.');
    const current = at(state.model, path);
    const image = await this.chooseImage(typeof current === 'string' ? current : '');
    if (image === undefined) return;
    await this.applyNative({ type: 'set', path, value: image }, state.documentId!, state.version);
  }
  async openSource(document = this.activeDocument) {
    if (document) await vscode.window.showTextDocument(document, { preview: false });
  }
  async resolveCustomTextEditor(document: vscode.TextDocument, panel: vscode.WebviewPanel) {
    const session: Session = { document, panel, ready: false };
    this.sessions.add(session);
    this.configure(panel.webview);
    this.setActive(document);
    const messages = panel.webview.onDidReceiveMessage(async (message) => {
      if (message?.type === 'ready') {
        session.ready = true;
        this.push(document);
        const key = document.uri.toString();
        for (const action of this.pendingActions.get(key) ?? [])
          await panel.webview.postMessage({ ...action, documentId: key });
        this.pendingActions.delete(key);
      } else await this.receive(panel.webview, document, message);
    });
    const focus = panel.onDidChangeViewState?.(() => {
      if (panel.active) this.setActive(document);
    });
    panel.onDidDispose(() => {
      this.sessions.delete(session);
      messages.dispose();
      focus?.dispose();
    });
  }
  private async receive(
    webview: vscode.Webview,
    document: vscode.TextDocument | undefined,
    message: any,
  ) {
    try {
      if (!message || typeof message !== 'object') return;
      if (message.type === 'ready') {
        if (document) await webview.postMessage(this.snapshot(document));
        else await webview.postMessage({ type: 'empty' });
        return;
      }
      if (!document || document.isClosed) throw new Error('Open a Compose file first.');
      if (message.documentId !== undefined && message.documentId !== document.uri.toString())
        throw new Error('The active Compose file changed. Please retry in the refreshed view.');
      switch (message.type) {
        case 'select':
          await this.selectResource(message.id, document);
          break;
        case 'pickImage':
          if (typeof message.requestId === 'string' && message.requestId.length <= 100) {
            let image: string | undefined;
            try {
              image = await this.chooseImage(
                typeof message.current === 'string' ? message.current : '',
              );
            } finally {
              await webview.postMessage({
                type: 'imagePicked',
                requestId: message.requestId,
                documentId: document.uri.toString(),
                image: !document.isClosed && this.activeDocument === document ? image : undefined,
              });
            }
          } else if (isOperation({ type: 'set', path: message.path, value: '' }))
            await this.searchImages(message.path);
          break;
        case 'requestMount':
          if (typeof message.sourceId === 'string' && typeof message.targetId === 'string')
            await this.runInCanvas({
              type: 'ui',
              action: 'mount',
              sourceId: message.sourceId,
              targetId: message.targetId,
            });
          break;
        case 'source':
          await this.openSource(document);
          break;
        case 'problems':
          await vscode.commands.executeCommand('workbench.actions.view.problems');
          break;
        case 'save':
          await document.save();
          this.push(document);
          break;
        case 'undo':
        case 'redo':
          await vscode.commands.executeCommand(message.type);
          break;
        case 'edit': {
          if (!isOperation(message.operation) || !Number.isSafeInteger(message.version))
            throw new Error('Invalid editor operation.');
          if (JSON.stringify(message.operation).length > 2_000_000)
            throw new Error('This edit is too large. Use the YAML source editor.');
          await this.editDocument(document, message.operation, message.version);
          break;
        }
      }
    } catch (error) {
      await webview.postMessage({ type: 'error', message: (error as Error).message });
      if (document && !document.isClosed) await webview.postMessage(this.snapshot(document));
    }
  }
  async formatYaml(document = vscode.window.activeTextEditor?.document ?? this.activeDocument) {
    if (!document || document.isClosed) return;
    try {
      await this.editDocument(document, { type: 'format' }, document.version);
    } catch (error) {
      await vscode.window.showErrorMessage((error as Error).message);
    }
  }
  async applyNative(operation: Operation, documentId: string, version: number) {
    const document = this.activeDocument;
    if (!document || document.uri.toString() !== documentId)
      throw new Error('The active Compose file changed. Select the property again.');
    if (!isOperation(operation)) throw new Error('Invalid property operation.');
    await this.editDocument(document, operation, version);
  }
  private async editDocument(document: vscode.TextDocument, operation: Operation, version: number) {
    const key = document.uri.toString();
    const pending = (this.queues.get(key) ?? Promise.resolve()).then(async () => {
      if (document.version !== version)
        throw new Error(
          'The document changed. Your view has been refreshed; please retry the edit.',
        );
      const next = applyOperation(document.getText(), operation);
      if (next !== document.getText()) {
        const edit = new vscode.WorkspaceEdit();
        edit.replace(document.uri, new vscode.Range(0, 0, document.lineCount, 0), next);
        if (!(await vscode.workspace.applyEdit(edit)))
          throw new Error('VS Code could not apply this edit.');
      }
      if (operation.type === 'rename') {
        const op = operation;
        if (this.selections.get(key) === `${op.kind}/${op.name}`)
          this.selections.set(key, `${op.kind}/${op.next}`);
      }
      if (
        operation.type === 'set' &&
        operation.path.length === 2 &&
        typeof operation.path[0] === 'string' &&
        resourceKinds.includes(operation.path[0])
      ) {
        this.selections.set(key, operation.path.join('/'));
      }
      if (operation.type === 'createConnected')
        this.selections.set(key, `${operation.targetKind}/${operation.name}`);
      this.push(document);
      if (
        operation.type === 'createConnected' ||
        (operation.type === 'set' &&
          operation.path.length === 2 &&
          typeof operation.path[0] === 'string' &&
          resourceKinds.includes(operation.path[0]))
      )
        await this.revealProperties?.();
    });
    const settled = pending.catch(() => {});
    this.queues.set(key, settled);
    try {
      await pending;
    } finally {
      if (this.queues.get(key) === settled) this.queues.delete(key);
    }
  }
  private configure(webview: vscode.Webview) {
    webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.joinPath(this.context.extensionUri, 'dist')],
    };
    const nonce = randomBytes(24).toString('base64');
    const resource = (name: string) =>
      webview.asWebviewUri(vscode.Uri.joinPath(this.context.extensionUri, 'dist', name));
    webview.html = `<!doctype html><html lang="en"><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src ${webview.cspSource} data:; font-src ${webview.cspSource}; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none';"><link rel="stylesheet" href="${resource('webview.css')}"><title>Docker Compose Studio</title></head><body><div id="root"></div><script nonce="${nonce}" src="${resource('webview.js')}"></script></body></html>`;
  }
}
