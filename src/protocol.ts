import type { Model, Path } from './schema';
export type Issue = {
  path: Path;
  message: string;
  severity: 'error' | 'warning';
  source: 'yaml' | 'schema' | 'reference';
  line?: number;
  column?: number;
};
export type Operation =
  | { type: 'format' }
  | { type: 'set'; path: Path; value: any }
  | { type: 'delete'; path: Path }
  | { type: 'rename'; kind: string; name: string; next: string }
  | {
      type: 'createConnected';
      sourceKind: string;
      source: string;
      targetKind: string;
      name: string;
      value: any;
      mount?: string;
    }
  | {
      type: 'connect' | 'disconnect';
      sourceKind: string;
      source: string;
      targetKind: string;
      target: string;
      mount?: string;
    };
export type Snapshot = {
  type: 'snapshot';
  version: number;
  text: string;
  model: Model;
  issues: Issue[];
  editable: boolean;
  filename: string;
  dirty: boolean;
  documentId?: string;
  selected?: string;
};
export type HubImage = {
  name: string;
  description: string;
  stars: number;
  pulls: number;
  official: boolean;
};
export type HubTag = { name: string; architectures: string[] };
export type HostMessage =
  | Snapshot
  | { type: 'empty' }
  | {
      type: 'ui';
      action: 'create' | 'mount';
      kind?: string;
      path?: Path;
      sourceId?: string;
      targetId?: string;
      documentId?: string;
    }
  | { type: 'error'; message: string }
  | { type: 'imagePicked'; requestId: string; documentId: string; image?: string };

export function isOperation(value: unknown): value is Operation {
  if (!value || typeof value !== 'object') return false;
  const op = value as any;
  if (op.type === 'format') return true;
  const name = (text: any) => typeof text === 'string' && text.length > 0 && text.length < 256;
  if (op.type === 'set' || op.type === 'delete') {
    return (
      Array.isArray(op.path) &&
      op.path.length > 0 &&
      op.path.length <= 40 &&
      op.path.every(
        (key: any) =>
          (typeof key === 'string' &&
            key.length < 512 &&
            !['__proto__', 'constructor', 'prototype'].includes(key)) ||
          (Number.isSafeInteger(key) && key >= 0),
      ) &&
      (op.type === 'delete' || Object.hasOwn(op, 'value'))
    );
  }
  if (op.type === 'rename') return name(op.kind) && name(op.name) && name(op.next);
  if (op.type === 'createConnected')
    return (
      [op.sourceKind, op.source, op.targetKind, op.name].every(name) &&
      Object.hasOwn(op, 'value') &&
      (op.mount === undefined || (typeof op.mount === 'string' && op.mount.length <= 4096))
    );
  return (
    ['connect', 'disconnect'].includes(op.type) &&
    [op.sourceKind, op.source, op.targetKind, op.target].every(name) &&
    (op.mount === undefined || (typeof op.mount === 'string' && op.mount.length <= 4096))
  );
}
