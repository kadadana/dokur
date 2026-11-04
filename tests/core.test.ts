import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { applyOperation, readCompose } from '../src/document';
import {
  childSchema,
  resourceKinds,
  resourceSchema,
  resolveSchema,
  schemaAt,
  variants,
} from '../src/schema';
import { relationField, relations } from '../src/relations';
import { validateModel } from '../src/validation';
import { isOperation, type Operation } from '../src/protocol';

const example = readFileSync(new URL('../examples/compose.yaml', import.meta.url), 'utf8');
const apply = (text: string, operation: Operation) =>
  readCompose(applyOperation(text, operation)).model;
const connect = (
  targetKind: string,
  target: string,
  extras: any = {},
): Extract<Operation, { target: string }> => ({
  type: 'connect',
  sourceKind: 'services',
  source: 'api',
  targetKind,
  target,
  ...extras,
});

test('the bundled Compose schema validates the example without errors', () => {
  assert.deepEqual(readCompose(example).issues, []);
  assert.equal(relations(readCompose(example).model).length, 6);
});

test('creating and editing a service from services: {} uses two-space block YAML', () => {
  let text = '# Created with Dokur Compose Studio\nname: my-project\nservices: {}\n';
  text = applyOperation(text, { type: 'set', path: ['services', 'api'], value: {} });
  assert.equal(Object.hasOwn(readCompose(text).model.services.api, 'image'), false);
  text = applyOperation(text, {
    type: 'set',
    path: ['services', 'api', 'image'],
    value: 'node:alpine',
  });
  assert.equal(
    text,
    '# Created with Dokur Compose Studio\nname: my-project\nservices:\n  api:\n    image: node:alpine\n',
  );
});

test('existing flow-style Compose becomes block YAML when its service is edited', () => {
  const text = '# keep header\nname: my-project\nservices: { api: { image: node:alpine } }\n';
  const next = applyOperation(text, {
    type: 'set',
    path: ['services', 'api', 'image'],
    value: 'node:24-alpine',
  });
  assert.equal(
    next,
    '# keep header\nname: my-project\nservices:\n  api:\n    image: node:24-alpine\n',
  );
});

test('formatting old flow collections preserves comments, aliases, values, and empty mappings', () => {
  const text =
    '# header\nx-base: &base {restart: always}\nservices: {api: {<<: *base, image: nginx, ports: ["8080:80"], volumes: [{type: volume, source: data, target: /data}], environment: {PORT: 80, ENABLED: false, TOKEN: "${TOKEN:-local}"}}} # services comment\nvolumes: {data: {}}\n';
  const next = applyOperation(text, { type: 'format' });
  assert.deepEqual(readCompose(next).model, readCompose(text).model);
  for (const content of [
    '# header',
    '# services comment',
    '&base',
    '*base',
    '${TOKEN:-local}',
    '  data: {}',
  ])
    assert.ok(next.includes(content), content);
  assert.match(next, /services:\n  api:\n/);
  assert.match(next, /    ports:\n      - "8080:80"/);
  assert.match(next, /    volumes:\n      - type: volume\n        source: data/);
  assert.equal(applyOperation(next, { type: 'format' }), next);
  assert.throws(() => applyOperation('services: [', { type: 'format' }), /Fix the YAML syntax/);
});

test('a cleared image can be re-added without replacing other service settings', () => {
  const text =
    'services:\n  api:\n    image: node:alpine\n    build: .\n    environment:\n      PORT: 3000\n';
  const cleared = applyOperation(text, { type: 'delete', path: ['services', 'api', 'image'] });
  assert.equal(Object.hasOwn(readCompose(cleared).model.services.api, 'image'), false);
  const model = apply(cleared, {
    type: 'set',
    path: ['services', 'api', 'image'],
    value: 'node:24-alpine',
  });
  assert.deepEqual(model.services.api, {
    image: 'node:24-alpine',
    build: '.',
    environment: { PORT: 3000 },
  });
});

test('schema renderer resolves references and all inherited service fields', () => {
  const service = resolveSchema(resourceSchema('services'));
  for (const field of [
    'image',
    'environment',
    'volumes',
    'build',
    'depends_on',
    'healthcheck',
    'deploy',
    'restart',
    'pre_start',
  ])
    assert.ok(service.properties?.[field], field);
  assert.equal(childSchema(service, 'not_a_compose_field'), undefined);
  assert.ok(childSchema(service, 'x-company'));
  assert.equal(childSchema(resourceSchema('networks'), 'image'), undefined);
  assert.ok(resourceKinds.includes('models'));
  assert.ok(resourceKinds.includes('jobs'));
});

test('schema forms expose the short and long syntax of nested fields', () => {
  const model = { services: { api: { ports: [{ target: 80, published: '8080' }] } } };
  const ports = schemaAt(['services', 'api', 'ports'], model);
  assert.ok(variants(ports.items!).some((s) => s.type === 'object'));
  assert.equal(
    schemaAt(['services', 'api', 'ports', 0, 'target'], model).type?.includes('integer'),
    true,
  );
});

test('schema validator rejects arbitrary properties and incorrect nested types', () => {
  const issues = validateModel({
    services: { api: { banana: true, healthcheck: { retries: [] } } },
    networks: { net: { image: 'nginx' } },
  });
  assert.ok(issues.some((i) => i.path.includes('banana')));
  assert.ok(issues.some((i) => i.path.includes('retries')));
  assert.ok(issues.some((i) => i.path.includes('image')));
});

test('editing preserves YAML comments, extension fields, anchors and scalar interpolation', () => {
  const text =
    '# project comment\nx-common: &common\n  restart: always # keep this\nservices:\n  api:\n    <<: *common\n    image: nginx # image comment\n    environment:\n      TOKEN: ${TOKEN:-local}\n';
  const next = applyOperation(text, {
    type: 'set',
    path: ['services', 'api', 'image'],
    value: 'nginx:alpine',
  });
  for (const content of [
    '# project comment',
    '# keep this',
    '# image comment',
    '&common',
    '*common',
    '${TOKEN:-local}',
  ])
    assert.ok(next.includes(content), content);
  assert.equal(readCompose(next).model.services.api.restart, 'always');
});

test('direct editing through aliases is blocked without altering source', () => {
  const text = 'x-base: &base\n  image: nginx\nservices:\n  api: *base\n';
  assert.throws(
    () => applyOperation(text, { type: 'set', path: ['services', 'api', 'image'], value: 'redis' }),
    /alias/,
  );
});

test('invalid YAML, duplicate keys, and cyclic aliases never enable visual writes', () => {
  for (const text of [
    'services: [',
    'services: {}\nservices: {}',
    'x-cycle: &cycle\n  self: *cycle',
  ]) {
    assert.equal(readCompose(text).editable, false, text);
    assert.throws(() => applyOperation(text, { type: 'set', path: ['name'], value: 'test' }));
  }
});

test('empty YAML can be initialized without losing the header comment', () => {
  const next = applyOperation('# hello\n', {
    type: 'set',
    path: ['services', 'api'],
    value: { image: 'nginx' },
  });
  assert.ok(next.includes('# hello'));
  assert.equal(readCompose(next).model.services.api.image, 'nginx');
});

test('service renaming updates short/long dependencies and namespace references', () => {
  const text =
    'services:\n  db:\n    image: postgres\n  api:\n    image: node\n    depends_on:\n      db:\n        condition: service_healthy\n        restart: true\n    network_mode: service:db\n    ipc: service:db\n    links: [db:storage]\n    volumes_from: [db:ro]\n    extends: {service: db}\n  web:\n    image: nginx\n    depends_on: [db]\n';
  const model = apply(text, { type: 'rename', kind: 'services', name: 'db', next: 'database' });
  assert.ok(model.services.database);
  assert.equal(model.services.db, undefined);
  assert.deepEqual(model.services.api.depends_on.database, {
    condition: 'service_healthy',
    restart: true,
  });
  assert.equal(model.services.api.network_mode, 'service:database');
  assert.equal(model.services.api.ipc, 'service:database');
  assert.deepEqual(model.services.api.links, ['database:storage']);
  assert.deepEqual(model.services.api.volumes_from, ['database:ro']);
  assert.equal(model.services.api.extends.service, 'database');
  assert.deepEqual(model.services.web.depends_on, ['database']);
});

test('renaming named volumes preserves mount options and ignores bind/anonymous mounts', () => {
  const text =
    "services:\n  api:\n    image: nginx\n    volumes:\n      - data:/one:ro\n      - {type: volume, source: data, target: /two, read_only: true}\n      - ./data:/three\n      - /anonymous\n      - 'C:\\data:/windows'\nvolumes:\n  data: {}\n";
  const before = readCompose(text);
  assert.equal(relations(before.model).filter((r) => r.targetKind === 'volumes').length, 2);
  const model = apply(text, { type: 'rename', kind: 'volumes', name: 'data', next: 'app-data' });
  assert.equal(model.services.api.volumes[0], 'app-data:/one:ro');
  assert.deepEqual(model.services.api.volumes[1], {
    type: 'volume',
    source: 'app-data',
    target: '/two',
    read_only: true,
  });
  assert.equal(model.services.api.volumes[2], './data:/three');
});

test('renaming secrets also updates build and init-container references', () => {
  const text =
    'services:\n  api:\n    image: nginx\n    secrets: [token]\n    build:\n      context: .\n      secrets: [{source: token, target: /token}]\n    pre_start:\n      - image: alpine\n        secrets: [token]\nsecrets:\n  token: {file: ./token}\n';
  const model = apply(text, { type: 'rename', kind: 'secrets', name: 'token', next: 'auth' });
  assert.deepEqual(model.services.api.secrets, ['auth']);
  assert.equal(model.services.api.build.secrets[0].source, 'auth');
  assert.deepEqual(model.services.api.pre_start[0].secrets, ['auth']);
});

test('renaming cannot overwrite an existing resource', () => {
  assert.throws(
    () =>
      applyOperation(example, { type: 'rename', kind: 'services', name: 'api', next: 'gateway' }),
    /already exists/,
  );
});

test('connect respects the schema relation directions and prevents cycles', () => {
  assert.equal(relationField('services', 'volumes'), 'volumes');
  assert.equal(relationField('networks', 'volumes'), undefined);
  assert.throws(
    () =>
      applyOperation(example, {
        type: 'connect',
        sourceKind: 'services',
        source: 'database',
        targetKind: 'services',
        target: 'gateway',
      }),
    /circular/,
  );
  assert.throws(
    () =>
      applyOperation(example, {
        type: 'connect',
        sourceKind: 'networks',
        source: 'backend',
        targetKind: 'volumes',
        target: 'pgdata',
      }),
    /cannot be connected/,
  );
});

test('connect keeps long syntax and configured network options intact', () => {
  const text =
    'services:\n  api:\n    image: nginx\n    networks:\n      front: {aliases: [public]}\nnetworks:\n  front: {}\n  back: {}\n';
  const model = apply(text, connect('networks', 'back'));
  assert.deepEqual(model.services.api.networks.front.aliases, ['public']);
  assert.equal(model.services.api.networks.back, null);
  assert.deepEqual(validateModel(model), []);
});

test('connecting a dependency to long syntax chooses a valid default condition', () => {
  const text = 'services:\n  api:\n    image: node\n    depends_on: {}\n  db: {image: postgres}\n';
  const model = apply(text, connect('services', 'db'));
  assert.deepEqual(model.services.api.depends_on.db, { condition: 'service_started' });
  assert.deepEqual(validateModel(model), []);
});

test('volume connections require a unique absolute mount path', () => {
  const text =
    'services:\n  api:\n    image: nginx\n    volumes: [existing:/data]\nvolumes:\n  existing: {}\n  data: {}\n';
  assert.throws(() => applyOperation(text, connect('volumes', 'data')), /absolute/);
  assert.throws(
    () => applyOperation(text, connect('volumes', 'data', { mount: '/data' })),
    /already mounted/,
  );
  const model = apply(text, connect('volumes', 'data', { mount: '/opt/data' }));
  assert.deepEqual(model.services.api.volumes[1], {
    type: 'volume',
    source: 'data',
    target: '/opt/data',
  });
  assert.deepEqual(validateModel(model), []);
});

test('disconnect removes repeated mounts without array index shifts', () => {
  const text =
    'services:\n  api:\n    image: nginx\n    volumes: [data:/a, other:/b, data:/c]\nvolumes:\n  data: {}\n  other: {}\n';
  const model = apply(text, { ...connect('volumes', 'data'), type: 'disconnect' });
  assert.deepEqual(model.services.api.volumes, ['other:/b']);
});

test('resources still in use cannot be deleted', () => {
  assert.throws(
    () => applyOperation(example, { type: 'delete', path: ['volumes', 'pgdata'] }),
    /still referenced/,
  );
  const model = apply(example, { type: 'delete', path: ['services', 'gateway'] });
  assert.equal(model.services.gateway, undefined);
});

test('network_mode prevents attaching a conflicting network', () => {
  const text = 'services:\n  api: {image: nginx, network_mode: host}\nnetworks:\n  net: {}\n';
  assert.throws(() => applyOperation(text, connect('networks', 'net')), /network_mode/);
  assert.ok(
    validateModel({
      services: { api: { image: 'nginx', network_mode: 'host', networks: ['net'] } },
    }).some((i) => i.message.includes('cannot be used together')),
  );
});

test('external include references are warnings while local missing resources are errors', () => {
  const model = { services: { api: { image: 'nginx', depends_on: ['missing'] } } };
  assert.equal(validateModel(model).find((i) => i.source === 'reference')?.severity, 'error');
  assert.equal(
    validateModel({ ...model, include: ['./other.yaml'] }).find((i) => i.source === 'reference')
      ?.severity,
    'warning',
  );
});

test('protocol rejects prototype keys, excessive paths, missing values and unknown operations', () => {
  assert.equal(isOperation({ type: 'format' }), true);
  assert.equal(isOperation({ type: 'set', path: ['__proto__', 'polluted'], value: true }), false);
  assert.equal(isOperation({ type: 'set', path: ['name'] }), false);
  assert.equal(isOperation({ type: 'execute', command: 'docker run' }), false);
  assert.equal(
    isOperation({ type: 'set', path: ['services', 'api', 'image'], value: 'nginx' }),
    true,
  );
});

test('drag-created resources and their connection are calculated together', () => {
  const text = 'services:\n  api: {image: node}\n';
  const next = applyOperation(text, {
    type: 'createConnected',
    sourceKind: 'services',
    source: 'api',
    targetKind: 'networks',
    name: 'private',
    value: {},
  });
  assert.deepEqual(readCompose(next).model.services.api.networks, ['private']);
  assert.deepEqual(readCompose(next).model.networks.private, {});
  assert.deepEqual(readCompose(next).issues, []);
});
test('failed connected creation cannot leave a resource behind', () => {
  const text =
    'services:\n  api:\n    image: node\n    volumes: [existing:/data]\nvolumes:\n  existing: {}\n';
  assert.throws(
    () =>
      applyOperation(text, {
        type: 'createConnected',
        sourceKind: 'services',
        source: 'api',
        targetKind: 'volumes',
        name: 'new-data',
        value: {},
        mount: '/data',
      }),
    /already mounted/,
  );
  assert.equal(readCompose(text).model.volumes['new-data'], undefined);
  assert.throws(
    () =>
      applyOperation(text, {
        type: 'createConnected',
        sourceKind: 'volumes',
        source: 'existing',
        targetKind: 'services',
        name: 'worker',
        value: { image: 'node' },
      }),
    /cannot be connected/,
  );
});
