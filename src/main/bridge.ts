import http from 'http';

export const BRIDGE_URL = 'http://127.0.0.1:3111';
const DEFAULT_TIMEOUT_MS = 8000;

/** Make an HTTP request to the local browser bridge. */
export function bridgeCall(path: string, method = 'GET', timeoutMs = DEFAULT_TIMEOUT_MS): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BRIDGE_URL);
    const req = http.request(url, { method }, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (chunk: Buffer) => chunks.push(chunk));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });
    req.on('error', reject);
    req.setTimeout(timeoutMs, () => { req.destroy(); reject(new Error('bridge timeout')); });
    req.end();
  });
}
