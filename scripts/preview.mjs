// Development-only browser harness. The shipped extension uses VS Code message passing.
import { createServer } from 'node:http';
import { readFile, mkdir } from 'node:fs/promises';
import { resolve, extname, sep } from 'node:path';
import { createRequire } from 'node:module';
import { build } from 'esbuild';
await mkdir('.preview', { recursive: true });
await build({
  entryPoints: ['src/document.ts'],
  outdir: '.preview',
  outExtension: { '.js': '.cjs' },
  platform: 'node',
  format: 'cjs',
  bundle: true,
});
const require = createRequire(import.meta.url);
const { readCompose, applyOperation } = require('../.preview/document.cjs');
const example = await readFile('examples/compose.yaml', 'utf8');
let text = example,
  version = 1,
  dirty = false;
let selected = '@project';
const clients = new Set();
const undo = [],
  redo = [];
function snapshot(surface = 'canvas') {
  const { model, issues, editable } = readCompose(text);
  return {
    type: 'snapshot',
    text,
    version,
    model,
    issues,
    editable,
    dirty,
    filename: 'compose.yaml',
    documentId: 'preview://compose.yaml',
    selected,
    surface,
  };
}
const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><link rel="stylesheet" href="/dist/webview.css"><title>Docker Compose Studio · Preview</title></head><body><div id="root"></div><script src="/preview-bridge.js"></script><script src="/dist/webview.js"></script></body></html>`;
const bridge = `const surface = new URLSearchParams(location.search).get('surface') || 'canvas';
const events = new EventSource('/events?surface=' + surface);
events.onmessage = event => window.dispatchEvent(new MessageEvent('message', {data: JSON.parse(event.data)}));
window.acquireVsCodeApi = () => ({ getState: () => JSON.parse(sessionStorage.getItem('dokur-state-' + surface) || '{}'), setState: state => sessionStorage.setItem('dokur-state-' + surface, JSON.stringify(state)), postMessage: async message => { try { const result = await fetch('/api/message', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({...message, surface}) }).then(r => r.json()); for (const data of result) window.dispatchEvent(new MessageEvent('message', { data })); } catch(error) { window.dispatchEvent(new MessageEvent('message', { data: {type:'error', message: error.message} })); } } });`;
const broadcast = () => {
  for (const client of clients)
    client.response.write(`data: ${JSON.stringify(snapshot(client.surface))}\n\n`);
};
const action = (message) => {
  for (const client of clients)
    if (client.surface === 'canvas')
      client.response.write(
        `data: ${JSON.stringify({ type: 'ui', ...message, documentId: 'preview://compose.yaml' })}\n\n`,
      );
};
const mime = {
  '.js': 'text/javascript',
  '.css': 'text/css',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.webp': 'image/webp',
};
const server = createServer(async (request, response) => {
  try {
    const url = new URL(request.url, 'http://127.0.0.1');
    if (url.pathname === '/events') {
      response.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        Connection: 'keep-alive',
      });
      const client = { response, surface: url.searchParams.get('surface') ?? 'canvas' };
      clients.add(client);
      response.write(`data: ${JSON.stringify(snapshot(client.surface))}\n\n`);
      request.on('close', () => clients.delete(client));
      return;
    }
    if (url.pathname === '/api/state') {
      response
        .writeHead(200, { 'Content-Type': 'application/json' })
        .end(JSON.stringify(snapshot()));
      return;
    }
    if (url.pathname.startsWith('/api/') && request.method === 'POST') {
      if (request.headers['content-type'] !== 'application/json') {
        response.writeHead(415).end();
        return;
      }
      let body = '';
      for await (const chunk of request) {
        body += chunk;
        if (body.length > 2_000_000) throw new Error('Request too large');
      }
      const message = JSON.parse(body);
      let messages = [];
      if (url.pathname === '/api/reset') {
        text = message.text ?? example;
        version++;
        dirty = false;
        selected = '@project';
        undo.length = redo.length = 0;
        messages = [snapshot()];
        broadcast();
      } else if (message.type === 'pickImage' && typeof message.requestId === 'string') {
        messages = [
          {
            type: 'imagePicked',
            requestId: message.requestId,
            documentId: 'preview://compose.yaml',
          },
          {
            type: 'error',
            message:
              'Image search uses VS Code Quick Pick. Open the extension in VS Code to search Docker Hub.',
          },
        ];
      } else {
        try {
          if (message.type === 'edit') {
            if (message.version !== version)
              throw new Error('The document changed. Retry the edit.');
            const next = applyOperation(text, message.operation);
            if (next !== text) {
              undo.push(text);
              redo.length = 0;
              text = next;
              version++;
              dirty = true;
            }
            if (message.operation.type === 'rename') {
              const op = message.operation;
              if (selected === op.kind + '/' + op.name) selected = op.kind + '/' + op.next;
            }
            if (message.operation.type === 'createConnected')
              selected = message.operation.targetKind + '/' + message.operation.name;
            if (message.operation.type === 'set' && message.operation.path.length === 2)
              selected = message.operation.path.join('/');
          }
          if (message.type === 'select') selected = message.id;
          if (message.type === 'requestMount')
            action({ action: 'mount', sourceId: message.sourceId, targetId: message.targetId });
          if (message.type === 'save') dirty = false;
          if (message.type === 'undo' && undo.length) {
            redo.push(text);
            text = undo.pop();
            version++;
            dirty = true;
          }
          if (message.type === 'redo' && redo.length) {
            undo.push(text);
            text = redo.pop();
            version++;
            dirty = true;
          }
        } catch (error) {
          messages.push({ type: 'error', message: error.message });
        }
        messages.push(snapshot(message.surface));
        if (['edit', 'select', 'save', 'undo', 'redo'].includes(message.type)) broadcast();
      }
      response
        .writeHead(200, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' })
        .end(JSON.stringify(messages));
      return;
    }
    if (url.pathname === '/') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
      return;
    }
    if (url.pathname === '/view') {
      response.writeHead(200, { 'Content-Type': 'text/html' }).end(html);
      return;
    }
    if (url.pathname === '/preview-bridge.js') {
      response.writeHead(200, { 'Content-Type': 'text/javascript' }).end(bridge);
      return;
    }
    const base = resolve('dist');
    const path = resolve('.' + decodeURIComponent(url.pathname));
    if (!path.startsWith(base + sep)) {
      response.writeHead(404).end();
      return;
    }
    const content = await readFile(path);
    response
      .writeHead(200, { 'Content-Type': mime[extname(path)] ?? 'application/octet-stream' })
      .end(content);
  } catch (error) {
    response.writeHead(500).end(error.message);
  }
});
server.listen(Number(process.env.DOKUR_PREVIEW_PORT ?? 4173), '127.0.0.1', () =>
  console.log('Dokur preview: http://127.0.0.1:4173'),
);
