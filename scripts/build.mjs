import * as esbuild from 'esbuild';
import { mkdir, copyFile, readFile, readdir, realpath, rm, writeFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
const workspace = await realpath('.');
const output = resolve(workspace, 'dist');
if (relative(workspace, output) !== 'dist')
  throw new Error('Build output must be inside the workspace dist directory.');
await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
const configs = [
  {
    entryPoints: ['src/extension.ts'],
    outfile: 'dist/extension.cjs',
    platform: 'node',
    format: 'cjs',
    external: ['vscode'],
    target: 'node20',
  },
  {
    entryPoints: ['webview/main.tsx'],
    outfile: 'dist/webview.js',
    platform: 'browser',
    format: 'iife',
    target: 'es2022',
    loader: { '.woff2': 'file', '.woff': 'file', '.png': 'file', '.webp': 'file' },
    assetNames: 'assets/[name]-[hash]',
  },
];
const watch = process.argv.includes('--watch');
const bundledPackages = new Set();
for (const config of configs) {
  const options = {
    ...config,
    bundle: true,
    minify: !watch,
    sourcemap: true,
    logLevel: 'info',
  };
  if (watch) {
    const context = await esbuild.context(options);
    await context.watch();
  } else {
    const { metafile } = await esbuild.build({ ...options, metafile: true });
    for (const input of Object.keys(metafile.inputs)) {
      const match = /^(.*\bnode_modules\/(?:@[^/]+\/)?[^/]+)\//.exec(input);
      if (match) bundledPackages.add(match[1]);
    }
  }
}
if (!watch) {
  const notices = [];
  for (const directory of [...bundledPackages].sort()) {
    const manifest = JSON.parse(await readFile(resolve(directory, 'package.json'), 'utf8'));
    const files = (await readdir(directory)).filter((name) =>
      /^(?:licen[cs]e|copying|notice)(?:\.|$)/i.test(name),
    );
    if (!files.length) throw new Error(`Missing license file for ${manifest.name}`);
    const contents = await Promise.all(
      files.map((file) => readFile(resolve(directory, file), 'utf8')),
    );
    notices.push(
      `${manifest.name} ${manifest.version}\n\n${contents.map((value) => value.trim()).join('\n\n')}`,
    );
  }
  await writeFile(resolve(output, 'THIRD-PARTY-NOTICES.txt'), notices.join('\n\n---\n\n') + '\n');
  const readme = await readFile('README.md', 'utf8');
  // Marketplace cannot fetch images from the private repository.
  await writeFile(
    resolve(output, 'marketplace-readme.md'),
    readme.replace(/^!\[[^\]\r\n]*\]\(media\/compose-studio\.png\)\r?\n(?:\r?\n)?/m, ''),
  );
}
await copyFile('schema/NOTICE.md', 'dist/SCHEMA-NOTICE.md');
await copyFile('schema/SCHEMA-LICENSE.txt', 'dist/SCHEMA-LICENSE.txt');
await copyFile('schema/version.json', 'dist/SCHEMA-VERSION.json');
await copyFile('webview/fonts/LICENSE.txt', 'dist/INTER-LICENSE.txt');
await copyFile('webview/fonts/NOTICE.md', 'dist/INTER-NOTICE.md');
