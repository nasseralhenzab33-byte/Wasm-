'use strict';
const http = require('node:http');
const path = require('node:path');
const { HttpError, parseJson, securityHeaders, send, serveStatic, clientIp } = require('./lib/http');
const auth = require('./lib/auth');
const router = require('./routes');

const PUBLIC = path.join(__dirname, '..', 'public');

function createApp() {
  return http.createServer(async (req, res) => {
    securityHeaders(res);
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const started = Date.now();
    try {
      if (!pathname.startsWith('/api/')) {
        if (req.method !== 'GET' && req.method !== 'HEAD') throw new HttpError(405, 'method_not_allowed', 'Method not allowed');
        if (serveStatic(PUBLIC, req, res, pathname)) return;
        throw new HttpError(404, 'not_found', 'غير موجود');
      }
      const m = router.match(req.method, pathname);
      if (!m) throw new HttpError(404, 'not_found', 'المسار غير موجود');
      auth.csrfCheck(req);
      const opts = m.handlers.find(h => typeof h === 'object') || {};
      const handler = m.handlers.find(h => typeof h === 'function');
      const headers = {};
      const ctx = {
        req, res, params: m.params, query: url.searchParams, ip: clientIp(req),
        user: auth.currentUser(req),
        body: await parseJson(req, opts.bodyLimit || 256 * 1024),
        setHeader: (k, v) => { headers[k] = v; },
      };
      const out = await handler(ctx);
      if (out && out.stream) return;
      if (out && out.raw) {
        res.writeHead(200, { 'Content-Type': out.type, 'Cache-Control': 'private, max-age=300', 'Content-Disposition': 'inline', ...headers });
        return res.end(out.raw);
      }
      if (out && out.status && out.body) return send(res, out.status, out.body, headers);
      return send(res, 200, out ?? { ok: true }, headers);
    } catch (e) {
      if (e instanceof HttpError) return send(res, e.status, { error: e.code, message: e.message, ...(e.extra || {}) });
      console.error(`[error] ${req.method} ${pathname}`, e);
      return send(res, 500, { error: 'server_error', message: 'حدث خطأ غير متوقع' });
    } finally {
      if (process.env.LOG_REQUESTS === '1') console.log(`${req.method} ${pathname} ${res.statusCode} ${Date.now() - started}ms`);
    }
  });
}

module.exports = { createApp };
