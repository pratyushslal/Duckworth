import { createReadStream, existsSync, statSync } from 'node:fs';
import { createServer, request as httpRequest } from 'node:http';
import { extname, isAbsolute, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const CONTENT_TYPES = new Map([
  ['.css', 'text/css; charset=utf-8'],
  ['.html', 'text/html; charset=utf-8'],
  ['.ico', 'image/x-icon'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.png', 'image/png'],
  ['.svg', 'image/svg+xml'],
  ['.webp', 'image/webp'],
  ['.woff2', 'font/woff2'],
]);

export function createStaticWebServer({ staticRoot, apiOrigin, upstreamHeaders = {} }) {
  const root = resolve(staticRoot);
  const upstream = new URL(apiOrigin);
  return createServer((request, response) => {
    const rawPath = new URL(request.url ?? '/', 'http://localhost').pathname;
    if (rawPath === '/health' || rawPath.startsWith('/api/')) {
      proxyRequest(request, response, upstream, upstreamHeaders);
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response.writeHead(405, { allow: 'GET, HEAD' }).end();
      return;
    }
    let decodedPath;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch {
      response.writeHead(400).end('Invalid path');
      return;
    }
    const candidate = resolve(root, `.${decodedPath}`);
    if (!isWithin(root, candidate)) {
      response.writeHead(400).end('Invalid path');
      return;
    }
    const file = existsSync(candidate) && statSync(candidate).isFile() ? candidate : resolve(root, 'index.html');
    if (!existsSync(file) || !statSync(file).isFile()) {
      response.writeHead(503).end('Duckworth release is not built');
      return;
    }
    response.writeHead(200, {
      'content-type': CONTENT_TYPES.get(extname(file).toLocaleLowerCase('en-US')) ?? 'application/octet-stream',
      'cache-control': extname(file) === '.html' ? 'no-cache' : 'public, max-age=31536000, immutable',
      'x-content-type-options': 'nosniff',
    });
    if (request.method === 'HEAD') response.end();
    else createReadStream(file).pipe(response);
  });
}

function proxyRequest(incoming, outgoing, upstream, upstreamHeaders) {
  const headers = { ...incoming.headers, ...upstreamHeaders, host: upstream.host };
  const proxy = httpRequest({
    protocol: upstream.protocol,
    hostname: upstream.hostname,
    port: upstream.port,
    method: incoming.method,
    path: incoming.url,
    headers,
  }, (response) => {
    outgoing.writeHead(response.statusCode ?? 502, response.headers);
    response.pipe(outgoing);
  });
  proxy.on('error', () => {
    if (!outgoing.headersSent) outgoing.writeHead(502, { 'content-type': 'application/json' });
    outgoing.end(JSON.stringify({ message: 'Duckworth API is unavailable' }));
  });
  incoming.pipe(proxy);
}

function isWithin(parent, child) {
  const path = relative(parent, child);
  return path === '' || (!path.startsWith('..') && !isAbsolute(path));
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
  const staticRoot = process.env.DUCKWORTH_STATIC_ROOT;
  const apiOrigin = process.env.DUCKWORTH_API_ORIGIN;
  const host = process.env.HOST ?? '0.0.0.0';
  const port = Number(process.env.PORT ?? 4200);
  if (!staticRoot || !apiOrigin || !Number.isInteger(port) || port < 1 || port > 65_535) {
    throw new Error('DUCKWORTH_STATIC_ROOT, DUCKWORTH_API_ORIGIN, and a valid PORT are required');
  }
  createStaticWebServer({ staticRoot, apiOrigin }).listen(port, host);
}
