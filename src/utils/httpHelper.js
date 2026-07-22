/**
 * Cross-Node HTTP/HTTPS request helper
 * Works across Node 14+, 16+, 18+, 20+, 22+ without relying on global fetch
 */

const https = require('https');
const http = require('http');
const { URL } = require('url');

/**
 * Universal HTTP/HTTPS request function
 * Returns object matching fetch response: { ok, status, json(), text() }
 */
const httpFetch = (targetUrl, options = {}) => {
  return new Promise((resolve, reject) => {
    try {
      const parsedUrl = new URL(targetUrl);
      const transport = parsedUrl.protocol === 'https:' ? https : http;

      const method = (options.method || 'GET').toUpperCase();
      const headers = { ...options.headers };

      let bodyString = null;
      if (options.body) {
        bodyString = typeof options.body === 'string' ? options.body : JSON.stringify(options.body);
        if (!headers['Content-Type'] && !headers['content-type']) {
          headers['Content-Type'] = 'application/json';
        }
        headers['Content-Length'] = Buffer.byteLength(bodyString);
      }

      const reqOptions = {
        hostname: parsedUrl.hostname,
        port: parsedUrl.port || (parsedUrl.protocol === 'https:' ? 443 : 80),
        path: parsedUrl.pathname + parsedUrl.search,
        method: method,
        headers: headers
      };

      const req = transport.request(reqOptions, (res) => {
        let responseBody = '';
        res.on('data', chunk => { responseBody += chunk; });
        res.on('end', () => {
          const status = res.statusCode || 200;
          const ok = status >= 200 && status < 300;

          resolve({
            ok,
            status,
            statusText: res.statusMessage || '',
            json: async () => {
              try {
                return JSON.parse(responseBody);
              } catch (_) {
                return {};
              }
            },
            text: async () => responseBody
          });
        });
      });

      req.on('error', (err) => {
        reject(err);
      });

      const timeoutMs = options.timeout || (options.signal ? 8000 : 15000);
      req.setTimeout(timeoutMs, () => {
        req.destroy(new Error(`Request timeout after ${timeoutMs}ms`));
      });

      if (bodyString) {
        req.write(bodyString);
      }
      req.end();
    } catch (err) {
      reject(err);
    }
  });
};

module.exports = httpFetch;
