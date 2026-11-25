/* Local test harness only. This file is not a Pages Function and adds no production auth bypass. */
import http from 'node:http';
import {readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import * as api from '../functions/api/private-offers.js';
import {fixture} from './fixture.js';

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
export async function startServer(f) {
  f ||= await fixture({create: false});
  const server = http.createServer(async (req, res) => {
    try {
      const origin = 'http://' + req.headers.host, url = new URL(req.url, origin);
      if (url.pathname === '/api/private-offers') {
        const chunks = []; for await (const chunk of req) chunks.push(chunk);
        const headers = {...req.headers};
        if ((headers.cookie || '').includes('v2_test_staff=1')) headers['Cf-Access-Jwt-Assertion'] = f.identity.jwt;
        const request = new Request(url, {method: req.method, headers, ...(['GET', 'HEAD'].includes(req.method) ? {} : {body: Buffer.concat(chunks)})});
        const handler = api['onRequest' + req.method[0] + req.method.slice(1).toLowerCase()];
        const response = handler ? await handler({request, env: f.env}) : new Response('', {status: 405});
        res.writeHead(response.status, Object.fromEntries(response.headers)); res.end(Buffer.from(await response.arrayBuffer())); return;
      }
      const file = url.pathname === '/admin/offers/' ? 'admin/offers/index.html' : url.pathname === '/offer/' ? 'offer/index.html' : decodeURIComponent(url.pathname) === '/assets/Priceless Auto Services Logo (1).png' ? 'assets/Priceless Auto Services Logo (1).png' : /^\/assets\/(deal[^/]*\.(?:js|css)|priceless-logo\.svg)$/.test(url.pathname) ? url.pathname.slice(1) : null;
      if (!file) { res.writeHead(404); res.end('Not found'); return; }
      const bytes = await readFile(path.join(root, file));
      res.writeHead(200, {'content-type': file.endsWith('.js') ? 'text/javascript' : file.endsWith('.css') ? 'text/css' : file.endsWith('.svg') ? 'image/svg+xml' : file.endsWith('.png') ? 'image/png' : 'text/html', 'cache-control': 'no-store'}); res.end(bytes);
    } catch (e) { res.writeHead(500); res.end('Local test server error'); process.stderr.write(e.stack + '\n'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {server, fixture: f, origin: 'http://127.0.0.1:' + server.address().port, close: () => new Promise(resolve => server.close(resolve))};
}
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const running = await startServer(); process.stdout.write('Local test server: ' + running.origin + '\n');
}
