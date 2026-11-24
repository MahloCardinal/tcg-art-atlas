import http from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const built = process.argv.includes('--dist');
const portIndex = process.argv.indexOf('--port');
const port = Number(portIndex >= 0 ? process.argv[portIndex + 1] : process.env.PORT || 5300);
const mime = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.json': 'application/json; charset=utf-8', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

export function resolveRequest(url) {
  const pathname = decodeURIComponent(new URL(url, 'http://localhost').pathname);
  if (pathname.includes('\0') || pathname.includes('\\')) return null;
  let base = built ? path.join(root, 'dist') : path.join(root, 'public');
  let relative = pathname === '/' ? '/index.html' : pathname;
  if (!built) {
    if (pathname === '/' || pathname === '/index.html') base = root;
    else if (pathname.startsWith('/src/')) { base = path.join(root, 'src'); relative = pathname.slice('/src'.length); }
    else if (pathname.startsWith('/public/')) relative = pathname.slice('/public'.length);
  }
  const candidate = path.resolve(base, '.' + relative);
  if (!candidate.startsWith(base + path.sep)) return null;
  return candidate;
}

const server = http.createServer(async (request, response) => {
  if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405, { Allow: 'GET, HEAD' }); response.end(); return; }
  try {
    const file = resolveRequest(request.url);
    if (!file || !(await stat(file)).isFile()) throw new Error('Not found');
    const data = await readFile(file);
    response.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache', 'X-Content-Type-Options': 'nosniff' });
    response.end(request.method === 'HEAD' ? undefined : data);
  } catch { response.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); response.end('Risorsa non trovata'); }
});
server.on('error', error => { console.error(`Impossibile avviare il server: ${error.message}`); process.exitCode = 1; });
server.listen(port, '127.0.0.1', () => console.log(`CList: http://localhost:${port}${built ? ' (build di produzione)' : ''}\nPremi Ctrl+C per fermare il server.`));
