import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readCompose } from '../src/document';
import {
  canAddProperty,
  currentVariant,
  propertyChildren,
  propertyPreview,
  propertySchema,
  propertyScope,
} from '../src/property-model';
import { childSchema } from '../src/schema';
import type { Snapshot } from '../src/protocol';
const state = (text: string, selected = 'services/api'): Snapshot => ({
  type: 'snapshot',
  text,
  ...readCompose(text),
  version: 1,
  filename: 'compose.yaml',
  dirty: false,
  documentId: 'test://compose.yaml',
  selected,
});
test('native property tree exposes an unset image without adding it to YAML', () => {
  const snapshot = state('services:\n  api: {}\n');
  assert.deepEqual(propertyScope(snapshot), ['services', 'api']);
  assert.deepEqual(propertyChildren(snapshot, ['services', 'api']), [
    { key: 'image', value: undefined, missing: true },
  ]);
  assert.equal(Object.hasOwn(snapshot.model.services.api, 'image'), false);
  assert.ok(childSchema(propertySchema(snapshot, ['services', 'api']), 'build'));
});
test('native property tree follows nested maps, numeric list indexes, and schema unions', () => {
  const snapshot = state(
    'services:\n  api:\n    environment: {PORT: 3000}\n    ports: ["8080:80"]\n',
  );
  assert.deepEqual(propertyChildren(snapshot, ['services', 'api', 'ports']), [
    { key: 0, value: '8080:80' },
  ]);
  assert.equal(propertyChildren(snapshot, ['services', 'api', 'environment'])[0].key, 'PORT');
  const schema = childSchema(propertySchema(snapshot, ['services', 'api', 'environment']), 'PORT')!;
  assert.equal(currentVariant(schema, 3000).type, 'number');
  assert.ok(canAddProperty(snapshot, ['services', 'api', 'environment']));
});
test('project properties exclude resource groups and show readable card summaries', () => {
  const snapshot = state('name: demo\nservices: {}\nnetworks: {}\nx-team: dev\n', '@project');
  assert.deepEqual(
    propertyChildren(snapshot, []).map((item) => item.key),
    ['name', 'x-team'],
  );
  assert.equal(propertyPreview([{ source: 'data', target: '/data' }]), 'data → /data');
  assert.equal(propertyPreview({ NODE_ENV: 'development' }), 'NODE_ENV=development');
  assert.equal(propertyPreview([]), 'Empty list');
});
