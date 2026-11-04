import { writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
const url =
  'https://raw.githubusercontent.com/compose-spec/compose-spec/refs/heads/main/schema/compose-spec.json';
const response = await fetch(url, { signal: AbortSignal.timeout(15000) });
if (!response.ok) throw new Error(`Schema download failed: ${response.status}`);
const text = await response.text();
const schema = JSON.parse(text);
if (!schema.$defs || !schema.properties?.services) throw new Error('Unexpected Compose schema');
await writeFile('schema/compose-spec.json', text);
await writeFile(
  'schema/version.json',
  JSON.stringify(
    {
      url,
      downloaded: new Date().toISOString(),
      sha256: createHash('sha256').update(text).digest('hex'),
    },
    null,
    2,
  ) + '\n',
);
console.log(
  'Compose schema updated. Run npm run check && npm test && npm run build before packaging.',
);
