import { test } from 'node:test';
import assert from 'node:assert/strict';
import { DockerHub } from '../src/hub';

test('Docker Hub searches encode input, normalize real fields, and cache requests', async () => {
  let calls = 0;
  const hub = new DockerHub(async (input, init) => {
    calls++;
    assert.ok(String(input).startsWith('https://hub.docker.com/v2/search/repositories/'));
    assert.ok(String(input).includes('query=nginx%26page%3D2'));
    assert.equal(init?.redirect, 'error');
    return Response.json({
      results: [
        {
          repo_name: 'nginx',
          short_description: 'Web server',
          is_official: true,
          star_count: 100,
          pull_count: 1000000,
        },
      ],
    });
  });
  const images = await hub.search('nginx&page=2');
  assert.deepEqual(images[0], {
    name: 'nginx',
    description: 'Web server',
    official: true,
    stars: 100,
    pulls: 1000000,
  });
  await hub.search('nginx&page=2');
  assert.equal(calls, 1);
  assert.deepEqual(await hub.search('a'), []);
});

test('Docker Hub tag lookup adds the official namespace and deduplicates architectures', async () => {
  const hub = new DockerHub(async (input) => {
    assert.ok(String(input).includes('/v2/repositories/library/nginx/tags/'));
    return Response.json({
      results: [
        {
          name: 'alpine',
          images: [
            { architecture: 'amd64' },
            { architecture: 'amd64' },
            { architecture: 'arm64' },
            { architecture: 'unknown' },
          ],
        },
      ],
    });
  });
  assert.deepEqual(await hub.tags('nginx'), [
    { name: 'alpine', architectures: ['amd64', 'arm64'] },
  ]);
  await assert.rejects(hub.tags('../../evil'), /Invalid/);
  await assert.rejects(hub.tags('https://evil.test'), /Invalid/);
});

test('registry rate limits and network failures are actionable errors', async () => {
  const hub = new DockerHub(async () => new Response('', { status: 429 }));
  await assert.rejects(hub.search('nginx'), /rate limit/);
  const offline = new DockerHub(async () => {
    throw new Error('offline');
  });
  await assert.rejects(offline.search('nginx'), /offline/);
});
