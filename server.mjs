import { createReadStream } from 'node:fs';
import { stat } from 'node:fs/promises';
import { createServer } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(fileURLToPath(new URL('.', import.meta.url)));
const lastArg = process.argv[process.argv.length - 1];
const maybePort = Number(process.env.PORT || lastArg);
const requestedPort = Number.isFinite(maybePort) && maybePort > 0 ? maybePort : 4173;
const host = '127.0.0.1';
const mimeTypes = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.md', 'text/markdown; charset=utf-8']
]);

function send(res, statusCode, body, type = 'text/plain; charset=utf-8') {
  res.writeHead(statusCode, {
    'cache-control': 'no-store',
    'content-type': type
  });
  res.end(body);
}

function resolveRequestPath(url) {
  const parsed = new URL(url, 'http://localhost');
  const pathname = decodeURIComponent(parsed.pathname);
  const candidate = path.resolve(root, '.' + pathname);
  if (candidate !== root && !candidate.startsWith(root + path.sep)) {
    return null;
  }
  return candidate;
}

const server = createServer(async (req, res) => {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    send(res, 405, 'Method not allowed');
    return;
  }

  const resolved = resolveRequestPath(req.url || '/');
  if (!resolved) {
    send(res, 403, 'Forbidden');
    return;
  }

  let filePath = resolved;
  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      filePath = path.join(filePath, 'index.html');
    }
    await stat(filePath);
  } catch {
    send(res, 404, 'Not found');
    return;
  }

  const ext = path.extname(filePath);
  res.writeHead(200, {
    'cache-control': 'no-store',
    'content-type': mimeTypes.get(ext) || 'application/octet-stream',
    'cross-origin-embedder-policy': 'require-corp',
    'cross-origin-opener-policy': 'same-origin'
  });

  if (req.method === 'HEAD') {
    res.end();
    return;
  }

  createReadStream(filePath).pipe(res);
});

function listen(port, retries = 20) {
  server.removeAllListeners('error');
  server.once('error', (error) => {
    if (error.code === 'EADDRINUSE' && retries > 0) {
      listen(port + 1, retries - 1);
      return;
    }
    throw error;
  });

  server.listen(port, host, () => {
    const address = server.address();
    console.log('GPU Stress Test running at http://' + host + ':' + address.port + '/');
  });
}

listen(requestedPort);
