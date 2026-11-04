import {
  isAlias,
  isCollection,
  isMap,
  isScalar,
  LineCounter,
  parseDocument,
  visit,
  type Document,
} from 'yaml';
import { resourceKinds, at, type Model, type Path } from './schema';
import type { Issue, Operation } from './protocol';
import { relationField, relations, serviceReferences, wouldCycle } from './relations';
import { validateModel } from './validation';

export function readCompose(text: string): {
  document: Document;
  model: Model;
  issues: Issue[];
  editable: boolean;
} {
  const lines = new LineCounter();
  const document = parseDocument(text, { merge: true, lineCounter: lines, keepSourceTokens: true });
  const issues: Issue[] = [...document.errors, ...document.warnings].map((error) => {
    const position = lines.linePos(error.pos[0]);
    return {
      path: [],
      message: error.message,
      severity: document.errors.includes(error as any) ? 'error' : 'warning',
      source: 'yaml',
      line: position.line,
      column: position.col,
    };
  });
  let model: Model = {};
  let editable = document.errors.length === 0;
  try {
    const value = document.toJS({ maxAliasCount: 100 });
    JSON.stringify(value); // Reject cyclic aliases before sending a snapshot to the webview.
    if (value != null && (typeof value !== 'object' || Array.isArray(value)))
      throw new Error(
        'A Compose document must be a YAML mapping. Open the source editor to correct it.',
      );
    model = value ?? {};
    if (editable) {
      for (const issue of validateModel(model)) {
        // Use the closest existing node for missing-property diagnostics.
        let node: any;
        for (let length = issue.path.length; length >= 0 && !node?.range; length--) {
          node = length ? document.getIn(issue.path.slice(0, length), true) : document.contents;
        }
        const position = lines.linePos(node?.range?.[0] ?? 0);
        issues.push({ ...issue, line: position.line, column: position.col });
      }
    }
  } catch (error) {
    editable = false;
    issues.push({ path: [], message: (error as Error).message, severity: 'error', source: 'yaml' });
  }
  return { document, model, issues, editable };
}

function writable(document: Document, path: Path) {
  for (let index = 1; index <= path.length; index++) {
    const node = document.getIn(path.slice(0, index), true);
    if (isAlias(node))
      throw new Error('This field uses a YAML alias. Edit its anchor in the YAML source editor.');
  }
}
function set(document: Document, path: Path, value: any) {
  writable(document, path);
  if (!document.contents) document.contents = document.createNode({});
  document.setIn(path, value);
}
function renameKey(document: Document, path: Path, old: string, next: string) {
  writable(document, path);
  const map = document.getIn(path, true);
  if (!isMap(map)) throw new Error('Expected a YAML mapping.');
  const pair = map.items.find((pair) => isScalar(pair.key) && pair.key.value === old);
  if (!pair || !isScalar(pair.key)) throw new Error('Resource no longer exists.');
  pair.key.value = next;
}
function resourceExists(model: Model, kind: string, name: string) {
  return resourceKinds.includes(kind) && Object.hasOwn(model[kind] ?? {}, name);
}

function blockYaml(document: Document): string {
  // Existing flow collections (including services: {}) retain their style when
  // setIn adds children. Normalize the AST while retaining comments and anchors.
  // Empty collections stay inline to preserve {} / [] rather than implying null.
  visit(document, (_key, node) => {
    if (isCollection(node)) node.flow = node.items.length === 0;
  });
  return document.toString({ indent: 2, lineWidth: 0 });
}

export function applyOperation(text: string, op: Operation): string {
  const { document, model, editable } = readCompose(text);
  if (!editable)
    throw new Error('Fix the YAML syntax in the source editor before using the visual editor.');
  if (op.type === 'createConnected') {
    if (
      !resourceExists(model, op.sourceKind, op.source) ||
      !relationField(op.sourceKind, op.targetKind) ||
      !resourceKinds.includes(op.targetKind)
    )
      throw new Error('These resource types cannot be connected.');
    if (
      !/^[a-zA-Z0-9._-]+$/.test(op.name) ||
      ['__proto__', 'constructor', 'prototype'].includes(op.name)
    )
      throw new Error('Enter a valid resource name.');
    if (Object.hasOwn(model[op.targetKind] ?? {}, op.name))
      throw new Error('A resource with that name already exists.');
    const created = applyOperation(text, {
      type: 'set',
      path: [op.targetKind, op.name],
      value: op.value,
    });
    // Both changes are calculated before the host applies a single WorkspaceEdit.
    return applyOperation(created, {
      type: 'connect',
      sourceKind: op.sourceKind,
      source: op.source,
      targetKind: op.targetKind,
      target: op.name,
      mount: op.mount,
    });
  }
  if (op.type === 'format') {
    return blockYaml(document);
  } else if (op.type === 'set') {
    set(document, op.path, op.value);
  } else if (op.type === 'delete') {
    if (
      op.path.length === 2 &&
      typeof op.path[0] === 'string' &&
      resourceKinds.includes(op.path[0])
    ) {
      const [kind, name] = op.path;
      if (
        relations(model).some(
          (r) =>
            r.targetKind === kind &&
            r.target === name &&
            !(r.sourceKind === kind && r.source === name),
        ) ||
        (kind === 'services' &&
          serviceReferences(model).some(
            (r) => r.name === name && !(r.path[0] === kind && r.path[1] === name),
          ))
      )
        throw new Error(
          'This resource is still referenced. Remove its connections and references first.',
        );
    }
    writable(document, op.path);
    document.deleteIn(op.path);
  } else if (op.type === 'rename') {
    if (!resourceExists(model, op.kind, op.name)) throw new Error('Resource no longer exists.');
    if (
      !/^[a-zA-Z0-9._-]+$/.test(op.next) ||
      ['__proto__', 'constructor', 'prototype'].includes(op.next)
    )
      throw new Error('Use letters, numbers, dots, underscores, or hyphens.');
    if (op.next === op.name) return text;
    if (Object.hasOwn(model[op.kind], op.next))
      throw new Error('A resource with that name already exists.');
    for (const r of relations(model).filter(
      (r) => r.targetKind === op.kind && r.target === op.name,
    )) {
      const old = at(model, r.path);
      if (typeof r.path.at(-1) === 'string')
        renameKey(document, r.path.slice(0, -1), op.name, op.next);
      else if (typeof old === 'object') set(document, [...r.path, 'source'], op.next);
      else set(document, r.path, op.next + (r.suffix ?? ''));
    }
    if (op.kind === 'services')
      for (const ref of serviceReferences(model).filter((r) => r.name === op.name))
        set(document, ref.path, ref.replace(op.next));
    renameKey(document, [op.kind], op.name, op.next);
  } else {
    const field = relationField(op.sourceKind, op.targetKind);
    if (
      !field ||
      !resourceExists(model, op.sourceKind, op.source) ||
      !resourceExists(model, op.targetKind, op.target)
    )
      throw new Error('These resources cannot be connected.');
    const path = [op.sourceKind, op.source, field];
    const existing = relations(model).filter(
      (r) =>
        r.sourceKind === op.sourceKind &&
        r.source === op.source &&
        r.targetKind === op.targetKind &&
        r.target === op.target &&
        r.path.length === 4,
    );
    if (op.type === 'disconnect') {
      for (const r of existing.sort((a, b) => Number(b.path.at(-1)) - Number(a.path.at(-1)))) {
        writable(document, r.path);
        document.deleteIn(r.path);
      }
    } else {
      if (existing.length) return text;
      if (
        op.targetKind === 'services' &&
        op.sourceKind === 'services' &&
        wouldCycle(model, op.source, op.target)
      )
        throw new Error('This connection would create a circular dependency.');
      if (field === 'networks' && model[op.sourceKind][op.source]?.network_mode)
        throw new Error('Remove network_mode before attaching a network.');
      const current = at(model, path);
      if (field === 'volumes') {
        if (!op.mount?.startsWith('/'))
          throw new Error('Enter an absolute container mount path, for example /data.');
        if (current !== undefined && !Array.isArray(current))
          throw new Error('Correct the volumes field before connecting.');
        const conflict = (current ?? []).some((entry: any) =>
          typeof entry === 'string'
            ? entry.split(':').slice(1).includes(op.mount!)
            : entry?.target === op.mount,
        );
        if (conflict) throw new Error('A volume is already mounted at this container path.');
        set(document, path, [
          ...(current ?? []),
          { type: 'volume', source: op.target, target: op.mount },
        ]);
      } else if (current && !Array.isArray(current) && typeof current === 'object') {
        set(
          document,
          [...path, op.target],
          field === 'depends_on'
            ? { condition: 'service_started' }
            : field === 'models'
              ? {}
              : null,
        );
      } else if (current === undefined || Array.isArray(current))
        set(document, path, [...(current ?? []), op.target]);
      else throw new Error(`Correct the ${field} field before connecting.`);
    }
  }
  return blockYaml(document);
}
