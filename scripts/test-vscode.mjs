import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { build } from 'esbuild';
import { downloadAndUnzipVSCode } from '@vscode/test-electron';
const root = resolve('.');
const workspace = join(root, '.preview', 'vscode-workspace');
await mkdir(workspace, { recursive: true });
await mkdir('artifacts', { recursive: true });
await writeFile(
  join(workspace, 'compose.yaml'),
  '# integration fixture\nname: test\nservices:\n  api:\n    image: node:22-alpine\n',
);
await mkdir(join(root, '.preview', 'vscode-user', 'User'), { recursive: true });
await writeFile(
  join(root, '.preview', 'vscode-user', 'User', 'settings.json'),
  JSON.stringify({
    'window.newWindowDimensions': 'maximized',
    'window.restoreWindows': 'none',
    'workbench.startupEditor': 'none',
    'extensions.autoUpdate': false,
    'security.workspace.trust.enabled': false,
    'telemetry.telemetryLevel': 'off',
  }),
);
await build({
  entryPoints: ['tests/vscode/index.ts'],
  outfile: '.preview/vscode-tests.cjs',
  platform: 'node',
  format: 'cjs',
  bundle: true,
  external: ['vscode'],
});
const installed =
  process.platform === 'win32' ? 'C:\\Program Files\\Microsoft VS Code\\Code.exe' : '';
const executable =
  process.env.DOKUR_VSCODE_PATH ??
  (existsSync(installed) ? installed : await downloadAndUnzipVSCode());
const args = [
  workspace,
  `--extensionDevelopmentPath=${root}`,
  `--extensionTestsPath=${join(root, '.preview', 'vscode-tests.cjs')}`,
  `--user-data-dir=${join(root, '.preview', 'vscode-user')}`,
  `--extensions-dir=${join(root, '.preview', 'vscode-extensions')}`,
  '--skip-welcome',
  '--skip-release-notes',
  '--disable-workspace-trust',
  '--disable-updates',
  '--disable-gpu',
  '--disable-extensions',
  '--no-sandbox',
];
const visual = process.argv.includes('--visual');
const env = { ...process.env, DOKUR_TEST_ROOT: root, ...(visual ? { DOKUR_VISUAL_QA: '1' } : {}) };
delete env.ELECTRON_RUN_AS_NODE;
const child = spawn(executable, args, { env, stdio: 'inherit', windowsHide: true });
const timeout = setTimeout(
  () => {
    child.kill();
    console.error('VS Code integration test timed out.');
    process.exitCode = 1;
  },
  visual ? 180_000 : 60_000,
);
child.on('exit', (code) => {
  clearTimeout(timeout);
  process.exitCode = code ?? 1;
});
child.on('error', (error) => {
  clearTimeout(timeout);
  console.error(error);
  process.exitCode = 1;
});
