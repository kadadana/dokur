import * as vscode from 'vscode';
import { resourceKinds } from './schema';
import type { Snapshot } from './protocol';

export type NavigatorItem =
  | {
      type: 'action';
      label: string;
      icon: string | { light: vscode.Uri; dark: vscode.Uri };
      command: string;
    }
  | { type: 'files' }
  | { type: 'file'; uri: vscode.Uri }
  | { type: 'resources' }
  | { type: 'kind'; kind: string }
  | { type: 'resource'; kind: string; name: string };
const icons: Record<string, string> = {
  services: 'package',
  networks: 'globe',
  volumes: 'database',
  secrets: 'key',
  configs: 'file-code',
  models: 'sparkle',
  jobs: 'tasklist',
};

/** Real VS Code tree items; navigation stays outside the canvas. */
export class DokurNavigator implements vscode.TreeDataProvider<NavigatorItem>, vscode.Disposable {
  private changed = new vscode.EventEmitter<NavigatorItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  private files: vscode.Uri[] = [];
  private disposables: vscode.Disposable[] = [];
  constructor(
    private current: () => Snapshot | undefined,
    private extensionUri: vscode.Uri,
  ) {
    const watcher = vscode.workspace.createFileSystemWatcher('**/*compose*.{yaml,yml}');
    this.disposables.push(
      watcher,
      watcher.onDidCreate(() => void this.refreshFiles()),
      watcher.onDidDelete(() => void this.refreshFiles()),
      vscode.workspace.onDidChangeWorkspaceFolders(() => void this.refreshFiles()),
    );
    void this.refreshFiles();
  }
  async refreshFiles() {
    this.files = (
      await vscode.workspace.findFiles(
        '**/*compose*.{yaml,yml}',
        '**/{node_modules,.git,.preview}/**',
        200,
      )
    ).sort((a, b) => a.path.localeCompare(b.path));
    this.refresh();
  }
  refresh() {
    this.changed.fire(undefined);
  }
  dispose() {
    this.changed.dispose();
    this.disposables.forEach((item) => item.dispose());
  }
  getChildren(item?: NavigatorItem): NavigatorItem[] {
    const snapshot = this.current();
    if (!item)
      return [
        {
          type: 'action',
          label: 'Architecture',
          icon: {
            light: vscode.Uri.joinPath(this.extensionUri, 'media', 'weave-light.svg'),
            dark: vscode.Uri.joinPath(this.extensionUri, 'media', 'weave-dark.svg'),
          },
          command: 'dokur.architecture',
        },
        { type: 'action', label: 'Add Resource…', icon: 'add', command: 'dokur.addResource' },
        {
          type: 'action',
          label: 'Project Settings',
          icon: 'settings-gear',
          command: 'dokur.projectSettings',
        },
        { type: 'action', label: 'Docker Hub', icon: 'search', command: 'dokur.searchImages' },
        { type: 'action', label: 'YAML Source', icon: 'code', command: 'dokur.source' },
        { type: 'action', label: 'Format YAML', icon: 'list-tree', command: 'dokur.format' },
        { type: 'action', label: 'Problems', icon: 'warning', command: 'dokur.problems' },
        { type: 'files' },
        ...(snapshot ? [{ type: 'resources' } as const] : []),
      ];
    if (item.type === 'files') return this.files.map((uri) => ({ type: 'file', uri }));
    if (item.type === 'resources') return resourceKinds.map((kind) => ({ type: 'kind', kind }));
    if (item.type === 'kind')
      return Object.keys(snapshot?.model[item.kind] ?? {}).map((name) => ({
        type: 'resource',
        kind: item.kind,
        name,
      }));
    return [];
  }
  getTreeItem(item: NavigatorItem): vscode.TreeItem {
    const snapshot = this.current();
    if (item.type === 'action') {
      const tree = new vscode.TreeItem(item.label);
      tree.id = item.command;
      tree.iconPath = typeof item.icon === 'string' ? new vscode.ThemeIcon(item.icon) : item.icon;
      tree.command = { command: item.command, title: item.label };
      return tree;
    }
    if (item.type === 'file') {
      const tree = new vscode.TreeItem(item.uri);
      tree.id = item.uri.toString();
      tree.description = vscode.workspace
        .asRelativePath(item.uri)
        .replace(/[^/\\]+$/, '')
        .replace(/[/\\]$/, '');
      tree.command = { command: 'dokur.open', title: 'Open architecture', arguments: [item.uri] };
      tree.contextValue = 'dokur.file';
      return tree;
    }
    if (item.type === 'files' || item.type === 'resources') {
      const tree = new vscode.TreeItem(
        item.type === 'files' ? 'Compose Files' : `Resources · ${snapshot?.filename ?? ''}`,
        vscode.TreeItemCollapsibleState.Expanded,
      );
      tree.id = item.type;
      tree.iconPath = new vscode.ThemeIcon(item.type === 'files' ? 'files' : 'layers');
      return tree;
    }
    if (item.type === 'kind') {
      const tree = new vscode.TreeItem(
        item.kind[0].toUpperCase() + item.kind.slice(1),
        vscode.TreeItemCollapsibleState.Expanded,
      );
      tree.id = `kind/${item.kind}`;
      tree.iconPath = new vscode.ThemeIcon(icons[item.kind] ?? 'symbol-object');
      tree.description = String(Object.keys(snapshot?.model[item.kind] ?? {}).length);
      tree.contextValue = 'dokur.kind';
      return tree;
    }
    const tree = new vscode.TreeItem(item.name);
    tree.contextValue = 'dokur.resource';
    tree.id = `${item.kind}/${item.name}`;
    tree.iconPath = new vscode.ThemeIcon(icons[item.kind] ?? 'symbol-object');
    const issues =
      snapshot?.issues.filter((issue) => issue.path[0] === item.kind && issue.path[1] === item.name)
        .length ?? 0;
    tree.description = issues ? `${issues} problems` : undefined;
    tree.command = {
      command: 'dokur.selectResource',
      title: 'Edit resource',
      arguments: [tree.id],
    };
    return tree;
  }
}
