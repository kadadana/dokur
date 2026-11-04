import * as vscode from 'vscode';
import {
  at,
  childSchema,
  initialValue,
  schemaAt,
  schemaTypes,
  type Path,
  type Schema,
} from './schema';
import {
  canAddProperty,
  currentVariant,
  propertyChildren,
  propertyPreview,
  propertySchema,
  propertyScope,
  propertyVariants,
} from './property-model';
import type { Operation, Snapshot } from './protocol';

export type PropertyItem = {
  type: 'root' | 'value' | 'add' | 'variant' | 'name';
  path: Path;
  documentId: string;
  version: number;
  label?: string;
};
export type PropertyDialogs = {
  input(options: vscode.InputBoxOptions): Thenable<string | undefined>;
  pick<T extends vscode.QuickPickItem>(
    items: T[],
    options: vscode.QuickPickOptions,
  ): Thenable<T | undefined>;
};
const dialogs: PropertyDialogs = {
  input: (options) => vscode.window.showInputBox(options),
  pick: (items, options) => vscode.window.showQuickPick(items, options),
};

/** Schema-driven native TreeView. No HTML or webview is used for properties. */
export class DokurProperties implements vscode.TreeDataProvider<PropertyItem>, vscode.Disposable {
  private changed = new vscode.EventEmitter<PropertyItem | undefined>();
  readonly onDidChangeTreeData = this.changed.event;
  constructor(
    private current: () => Snapshot | undefined,
    private apply: (operation: Operation, documentId: string, version: number) => Promise<void>,
    private pickImage: (path: Path) => Promise<void>,
    private ui: PropertyDialogs = dialogs,
  ) {}
  dispose() {
    this.changed.dispose();
  }
  refresh() {
    this.changed.fire(undefined);
  }
  root(): PropertyItem | undefined {
    const state = this.current();
    return state?.documentId
      ? {
          type: 'root',
          path: propertyScope(state),
          documentId: state.documentId,
          version: state.version,
        }
      : undefined;
  }
  private state(item: PropertyItem): Snapshot {
    const state = this.current();
    if (!state || state.documentId !== item.documentId || state.version !== item.version)
      throw new Error('The Compose file changed. Select the property again.');
    return state;
  }
  private item(
    type: PropertyItem['type'],
    path: Path,
    state: Snapshot,
    label?: string,
  ): PropertyItem {
    return { type, path, documentId: state.documentId!, version: state.version, label };
  }
  getChildren(item?: PropertyItem): PropertyItem[] {
    const state = this.current();
    if (!state?.documentId) return [];
    if (!item) return [this.root()!];
    if (item.documentId !== state.documentId || !['root', 'value'].includes(item.type)) return [];
    const value = at(state.model, item.path);
    if (item.type !== 'root' && (value === null || typeof value !== 'object')) return [];
    const children: PropertyItem[] = [];
    if (item.type === 'root' && item.path.length === 2)
      children.push(this.item('name', item.path, state, 'Resource key'));
    children.push(
      ...propertyChildren(state, item.path).map(({ key }) =>
        this.item('value', [...item.path, key], state),
      ),
    );
    if (canAddProperty(state, item.path))
      children.push(
        this.item('add', item.path, state, Array.isArray(value) ? 'Add item…' : 'Add property…'),
      );
    if (item.type === 'value' && propertyVariants(schemaAt(item.path, state.model)).length > 1)
      children.push(this.item('variant', item.path, state, 'Change type / syntax…'));
    return children;
  }
  getParent(item: PropertyItem): PropertyItem | undefined {
    if (item.type === 'root') return undefined;
    const state = this.current();
    if (!state || state.documentId !== item.documentId) return undefined;
    const path = item.type === 'value' ? item.path.slice(0, -1) : item.path;
    return this.item(path.length === propertyScope(state).length ? 'root' : 'value', path, state);
  }
  getTreeItem(item: PropertyItem): vscode.TreeItem {
    const state = this.current();
    const value = state?.documentId === item.documentId ? at(state.model, item.path) : undefined;
    if (item.type === 'root') {
      const name = item.path.at(-1) ?? state?.model.name ?? 'Project settings';
      const tree = new vscode.TreeItem(String(name), vscode.TreeItemCollapsibleState.Expanded);
      tree.id = `${item.documentId}:root:${JSON.stringify(item.path)}`;
      tree.description = item.path.length ? String(item.path[0]).replace(/s$/, '') : 'project';
      tree.contextValue = item.path.length ? 'dokur.selectedResource' : 'dokur.project';
      tree.iconPath = new vscode.ThemeIcon(item.path.length ? 'symbol-object' : 'settings-gear');
      return tree;
    }
    const tree = new vscode.TreeItem(item.label ?? String(item.path.at(-1)));
    tree.id = `${item.documentId}:${item.type}:${JSON.stringify(item.path)}`;
    if (item.type === 'add' || item.type === 'variant' || item.type === 'name') {
      tree.iconPath = new vscode.ThemeIcon(
        item.type === 'add' ? 'add' : item.type === 'variant' ? 'symbol-misc' : 'symbol-key',
      );
      if (item.type === 'name') {
        tree.description = String(item.path.at(-1));
        tree.tooltip = `Key under ${item.path[0]} in this Compose file. References use this key. Renaming also updates supported local references; a separate name property is unchanged.`;
      }
      const command =
        item.type === 'add'
          ? 'dokur.property.add'
          : item.type === 'variant'
            ? 'dokur.property.type'
            : 'dokur.property.rename';
      tree.command = { command, title: tree.label as string, arguments: [item] };
      return tree;
    }
    const collection = value !== null && typeof value === 'object';
    tree.collapsibleState = collection
      ? vscode.TreeItemCollapsibleState.Collapsed
      : vscode.TreeItemCollapsibleState.None;
    tree.description = collection
      ? `${Array.isArray(value) ? value.length + ' items' : Object.keys(value).length + ' properties'}`
      : propertyPreview(value);
    const image = item.path.length === 3 && item.path.at(-1) === 'image';
    tree.contextValue = image
      ? 'dokur.imageProperty'
      : collection
        ? 'dokur.collectionProperty'
        : 'dokur.property';
    tree.iconPath = new vscode.ThemeIcon(
      image
        ? 'package'
        : collection
          ? Array.isArray(value)
            ? 'symbol-array'
            : 'symbol-object'
          : typeof value === 'boolean'
            ? 'symbol-boolean'
            : typeof value === 'number'
              ? 'symbol-number'
              : 'symbol-string',
    );
    const schema = state ? schemaAt(item.path, state.model) : {};
    tree.tooltip = `${item.path.join('.')}\n${schema.description ?? ''}\n${propertyPreview(value)}`;
    if (!collection)
      tree.command = {
        command: image ? 'dokur.property.image' : 'dokur.property.change',
        title: image ? 'Search Docker Hub or enter an image manually' : 'Change value',
        arguments: [item],
      };
    return tree;
  }
  private async value(
    schema: Schema,
    current: any,
    title: string,
    chooseType = false,
  ): Promise<{ value: any } | undefined> {
    let selected = currentVariant(schema, current);
    const choices = propertyVariants(schema);
    if (chooseType || (current === undefined && choices.length > 1)) {
      const picked = await this.ui.pick(
        choices.map((schema, index) => ({
          label: schemaTypes(schema).join(' / ') || `Variant ${index + 1}`,
          description: schema.description,
          schema,
        })),
        { title, placeHolder: 'Choose a value type' },
      );
      if (!picked) return;
      selected = picked.schema;
    }
    if (Object.hasOwn(selected, 'const')) return { value: selected.const };
    if (selected.enum) {
      const picked = await this.ui.pick(
        selected.enum.map((value) => ({ label: String(value), value })),
        { title },
      );
      return picked ? { value: picked.value } : undefined;
    }
    const type = schemaTypes(selected)[0];
    if (type === 'object' || type === 'array') return { value: initialValue(selected) };
    if (type === 'null') return { value: null };
    if (type === 'boolean') {
      const picked = await this.ui.pick(
        [
          { label: 'true', value: true },
          { label: 'false', value: false },
        ],
        { title },
      );
      return picked ? { value: picked.value } : undefined;
    }
    const numeric = type === 'integer' || type === 'number';
    const text = await this.ui.input({
      title,
      value: current === undefined || current === null ? '' : String(current),
      prompt: selected.description,
      ignoreFocusOut: true,
      validateInput: numeric
        ? (text) =>
            !text.trim() || !Number.isFinite(Number(text))
              ? 'Enter a number.'
              : type === 'integer' && !Number.isInteger(Number(text))
                ? 'Enter a whole number.'
                : selected.minimum !== undefined && Number(text) < selected.minimum
                  ? `Minimum: ${selected.minimum}`
                  : selected.maximum !== undefined && Number(text) > selected.maximum
                    ? `Maximum: ${selected.maximum}`
                    : undefined
        : undefined,
    });
    return text === undefined ? undefined : { value: numeric ? Number(text) : text };
  }
  async change(item: PropertyItem, chooseType = false) {
    const state = this.state(item);
    if (!item.path.length) return;
    const old = at(state.model, item.path);
    const result = await this.value(
      schemaAt(item.path, state.model),
      old,
      item.path.join(' → '),
      chooseType,
    );
    if (!result) return;
    const image = item.path.length === 3 && item.path.at(-1) === 'image';
    if (image && typeof result.value === 'string') result.value = result.value.trim();
    if (image && result.value === '') {
      if (old !== undefined)
        await this.apply({ type: 'delete', path: item.path }, item.documentId, item.version);
      return;
    }
    await this.apply(
      { type: 'set', path: item.path, value: result.value },
      item.documentId,
      item.version,
    );
  }
  async add(item: PropertyItem) {
    const state = this.state(item);
    const value = at(state.model, item.path);
    if (item.type !== 'root' && (value === null || typeof value !== 'object'))
      throw new Error('Select an object or list to add a property.');
    const schema = propertySchema(state, item.path);
    let key: string | number;
    let child: Schema;
    if (Array.isArray(value)) {
      key = value.length;
      child = schema.items ?? {};
    } else {
      const options = Object.entries(schema.properties ?? {})
        .filter(([key]) => !Object.hasOwn(value ?? {}, key))
        .map(([key, schema]) => ({ label: key, description: schema.description }));
      const dynamic =
        Object.keys(schema.patternProperties ?? {}).length > 0 ||
        (schema.additionalProperties !== false && schema.unevaluatedProperties !== false);
      if (dynamic) options.push({ label: 'Custom key / x- extension…', description: 'custom' });
      if (!options.length) return;
      const choice = await this.ui.pick(options, {
        title: 'Add property',
        placeHolder: item.path.join('.'),
      });
      if (!choice) return;
      const chosen =
        choice.description === 'custom'
          ? await this.ui.input({
              title: 'Property name',
              ignoreFocusOut: true,
              validateInput: (key) =>
                !key || ['__proto__', 'constructor', 'prototype'].includes(key)
                  ? 'Enter a valid property name.'
                  : Object.hasOwn(value ?? {}, key)
                    ? 'This key already exists.'
                    : !childSchema(schema, key)
                      ? 'This key is not allowed by the Compose schema.'
                      : undefined,
            })
          : choice.label;
      if (!chosen) return;
      key = chosen;
      child = childSchema(schema, key) ?? {};
    }
    const result = await this.value(child, undefined, `Add ${String(key)}`);
    if (result)
      await this.apply(
        { type: 'set', path: [...item.path, key], value: result.value },
        item.documentId,
        item.version,
      );
  }
  async remove(item: PropertyItem) {
    const state = this.state(item);
    if (item.type !== 'root' && (item.type !== 'value' || at(state.model, item.path) === undefined))
      return;
    if (item.path.length)
      await this.apply({ type: 'delete', path: item.path }, item.documentId, item.version);
  }
  async rename(item: PropertyItem) {
    const state = this.state(item);
    const path = propertyScope(state);
    if (path.length !== 2) return;
    const [kind, name] = path as string[];
    const next = await this.ui.input({
      title: 'Resource key',
      value: name,
      prompt: `Key under ${kind}. Supported local references are updated; a separate name property is unchanged.`,
      ignoreFocusOut: true,
      validateInput: (text) =>
        !/^[a-zA-Z0-9._-]+$/.test(text) || ['__proto__', 'constructor', 'prototype'].includes(text)
          ? 'Use letters, numbers, dots, underscores, or hyphens.'
          : text !== name && Object.hasOwn(state.model[kind] ?? {}, text)
            ? 'A resource with that key already exists.'
            : undefined,
    });
    if (next && next !== name)
      await this.apply({ type: 'rename', kind, name, next }, item.documentId, item.version);
  }
  async image(item: PropertyItem) {
    this.state(item);
    await this.pickImage(item.path);
  }
}
