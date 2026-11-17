// Local stand-in for the Apps Script web app: the real `handle` from
// apps-script/Code.gs over an in-memory store, served by node:http.
//   node tools/fake-api.mjs        (PORT / TOKEN env override 8787 / dev)
import http from 'node:http';
import { randomUUID } from 'node:crypto';
import { realpathSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { loadGs } from '../tests/helpers/load-gs.mjs';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type',
};

export function startFakeApi({ port = 8787, token = 'dev' } = {}) {
  const { handle } = loadGs();
  const rows = [];
  const store = {
    readAll: () => rows.map((r) => ({ ...r })),
    append: (row) => {
      rows.push({ ...row });
    },
    replaceAt: (i, row) => {
      rows[i] = { ...row };
    },
  };
  const ctx = { token, store, now: () => new Date().toISOString(), uuid: () => randomUUID() };

  const send = (res, status, obj) => {
    res.writeHead(status, { ...CORS, 'Content-Type': 'application/json; charset=utf-8' });
    res.end(JSON.stringify(obj));
  };

  const server = http.createServer((req, res) => {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, CORS);
      res.end();
      return;
    }
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'invalid' });
      return;
    }
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      let body;
      try {
        body = JSON.parse(Buffer.concat(chunks).toString('utf8'));
      } catch (_) {
        send(res, 200, { ok: false, error: 'invalid' });
        return;
      }
      send(res, 200, handle(body, ctx));
    });
    req.on('error', () => send(res, 400, { ok: false, error: 'invalid' }));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      const { port: actual } = server.address();
      resolve({
        url: `http://127.0.0.1:${actual}/`,
        close: () =>
          new Promise((done) => {
            server.close(() => done());
            server.closeAllConnections();
          }),
      });
    });
  });
}

const isMain = (() => {
  try {
    return !!process.argv[1] && import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href;
  } catch (_) {
    return false;
  }
})();

if (isMain) {
  const port = Number(process.env.PORT) || 8787;
  const token = process.env.TOKEN || 'dev';
  const { url } = await startFakeApi({ port, token });
  console.log(`fake api listening at ${url} (token: ${token})`);
}
