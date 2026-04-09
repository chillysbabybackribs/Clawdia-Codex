import * as http from 'http';
import * as fs from 'fs';
import { URL } from 'url';
import { BrowserWindow } from 'electron';
import type { BrowserService } from './browser/BrowserService';
import { IPC_EVENTS } from './ipc-channels';

const DEFAULT_PORT = 3111;

// ── Ref ID management ────────────────────────────────────────────────────────

// Ref ID -> CSS selector map, per tab
const refMaps = new Map<string, Map<string, string>>();

function getRefMap(tabId: string): Map<string, string> {
  if (!refMaps.has(tabId)) refMaps.set(tabId, new Map());
  return refMaps.get(tabId)!;
}

function clearRefs(tabId: string): void {
  refMaps.delete(tabId);
}

/** Clean up ref storage for a closed tab. Called by ElectronBrowserService. */
export function clearRefsForTab(tabId: string): void {
  refMaps.delete(tabId);
}

function resolveRef(tabId: string, ref: string): string | null {
  return refMaps.get(tabId)?.get(ref) ?? null;
}

// ── HTTP helpers ─────────────────────────────────────────────────────────────

function json(res: http.ServerResponse, status: number, body: unknown): void {
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(payload),
  });
  res.end(payload);
}

function ok(res: http.ServerResponse, data: unknown = {}): void {
  json(res, 200, { ok: true, data });
}

function fail(res: http.ServerResponse, status: number, error: string): void {
  json(res, status, { ok: false, error });
}

function readBody(req: http.IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

// ── Bridge server ────────────────────────────────────────────────────────────

/** Resolve the effective tab ID for ref-scoped operations.
 *  If an explicit tabId is provided, use it. Otherwise resolve from the active tab. */
function resolveEffectiveTabId(requestedTabId: string | null, browserService: BrowserService): string | null {
  if (requestedTabId) return requestedTabId;
  return browserService.getActiveTabId();
}

export function startBrowserBridge(browserService: BrowserService, port?: number): void {
  const listenPort = port ?? (Number(process.env.BROWSER_BRIDGE_PORT) || DEFAULT_PORT);

  const server = http.createServer(async (req, res) => {
    const parsed = new URL(req.url ?? '/', `http://127.0.0.1:${listenPort}`);
    const path = parsed.pathname;
    const params = parsed.searchParams;
    const method = (req.method ?? 'GET').toUpperCase();

    try {
      // ── Navigation ──────────────────────────────────────────────────
      if (path === '/navigate' && method === 'GET') {
        const url = params.get('url');
        if (!url) return fail(res, 400, 'missing ?url= parameter');
        const navTabId = params.get('tabId');
        if (navTabId && browserService.getWebContentsByTabId) {
          // Tab-scoped navigation: load URL in a specific tab without switching active tab
          const tabWc = browserService.getWebContentsByTabId(navTabId);
          if (!tabWc) return fail(res, 400, `tab not found: ${navTabId}`);
          await tabWc.loadURL(url);
        } else {
          await browserService.navigate(url);
        }
        // Auto-show browser panel so the user sees navigation live
        const win = BrowserWindow.getAllWindows()[0];
        if (win && !win.webContents.isDestroyed()) {
          win.webContents.send(IPC_EVENTS.BROWSER_AUTO_SHOW);
        }
        // Include tab_id so callers can scope subsequent operations to this tab
        const navTabIdResult = navTabId || browserService.getActiveTabId();
        return ok(res, { url, tab_id: navTabIdResult });
      }

      if (path === '/back' && method === 'GET') {
        await browserService.back();
        return ok(res);
      }

      if (path === '/forward' && method === 'GET') {
        await browserService.forward();
        return ok(res);
      }

      if (path === '/refresh' && method === 'GET') {
        await browserService.refresh();
        return ok(res);
      }

      // ── Tabs ────────────────────────────────────────────────────────
      if (path === '/tabs' && method === 'GET') {
        return ok(res, { tabs: browserService.listTabs() });
      }

      if (path === '/tabs/new' && method === 'POST') {
        const url = params.get('url') || undefined;
        const activate = params.get('activate') !== 'false';
        const tab = await browserService.newTab(url, activate);
        // Auto-show browser panel for new tab
        if (activate) {
          const win = BrowserWindow.getAllWindows()[0];
          if (win && !win.webContents.isDestroyed()) {
            win.webContents.send(IPC_EVENTS.BROWSER_AUTO_SHOW);
          }
        }
        return ok(res, { tab });
      }

      if (path === '/tabs/switch' && method === 'POST') {
        const id = params.get('id');
        if (!id) return fail(res, 400, 'missing ?id= parameter');
        await browserService.switchTab(id);
        return ok(res);
      }

      if (path === '/tabs/close' && method === 'POST') {
        const id = params.get('id');
        if (!id) return fail(res, 400, 'missing ?id= parameter');
        await browserService.closeTab(id);
        return ok(res);
      }

      // ── Page content ────────────────────────────────────────────────
      // Optional ?tabId= scopes operations to a specific tab (safe for concurrent access).
      // Without tabId, operations target the active tab (legacy behavior).
      const requestedTabId = params.get('tabId');
      const wc = requestedTabId && browserService.getWebContentsByTabId
        ? browserService.getWebContentsByTabId(requestedTabId)
        : browserService.getActiveWebContents();

      if (path === '/page-text' && method === 'GET') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const text = await wc.executeJavaScript('document.body.innerText');
        return ok(res, { text });
      }

      if (path === '/extract-links' && method === 'GET') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const links = await wc.executeJavaScript(`
          [...document.querySelectorAll('a[href]')].map(a => {
            const href = a.href;
            const text = (a.innerText || a.textContent || '').trim().slice(0, 200);
            return { url: href, text };
          }).filter(l => {
            if (!l.url || !l.text || l.text.length < 5) return false;
            if (l.url.startsWith('javascript:')) return false;
            if (l.url.includes('#') && !l.url.includes('/#/')) return false;
            // Filter out search engine internal links
            if (l.url.includes('/url?') || l.url.includes('/search?') || l.url.includes('&q=')) return false;
            if (/google\\.(com|\\w{2,3})(\\/|$)/.test(new URL(l.url).hostname)) return false;
            if (/bing\\.com|yahoo\\.com|duckduckgo\\.com|baidu\\.com/.test(l.url)) return false;
            // Filter out common non-content links
            if (/support\\.|accounts\\.|login\\.|signin\\.|maps\\.|translate\\.|play\\./.test(l.url)) return false;
            if (l.url.startsWith(location.origin)) return false;
            if (!/^https?:\\/\\//.test(l.url)) return false;
            return true;
          }).slice(0, 15)
        `);
        return ok(res, { links });
      }

      if (path === '/page-html' && method === 'GET') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const html = await wc.executeJavaScript('document.documentElement.outerHTML');
        return ok(res, { html });
      }

      if (path === '/screenshot' && method === 'GET') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const image = await wc.capturePage();
        const filePath = params.get('path');
        if (filePath) {
          fs.writeFileSync(filePath, image.toPNG());
          return ok(res, { path: filePath });
        }
        return ok(res, { base64: image.toPNG().toString('base64') });
      }

      // ── DOM interaction ─────────────────────────────────────────────
      if (path === '/execute-js' && method === 'POST') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const script = await readBody(req);
        if (!script.trim()) return fail(res, 400, 'empty script body');
        const result = await wc.executeJavaScript(script);
        return ok(res, { result });
      }

      if (path === '/click' && method === 'POST') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const selector = params.get('selector');
        if (!selector) return fail(res, 400, 'missing ?selector= parameter');
        const safeSelector = JSON.stringify(selector);
        await wc.executeJavaScript(
          `(() => { const el = document.querySelector(${safeSelector}); if (!el) throw new Error('element not found: ' + ${safeSelector}); el.click(); })()`,
        );
        return ok(res);
      }

      if (path === '/type' && method === 'POST') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const selector = params.get('selector');
        const text = params.get('text');
        if (!selector) return fail(res, 400, 'missing ?selector= parameter');
        if (text === null) return fail(res, 400, 'missing ?text= parameter');
        const safeSelector = JSON.stringify(selector);
        const safeText = JSON.stringify(text);
        await wc.executeJavaScript(
          `(() => { const el = document.querySelector(${safeSelector}); if (!el) throw new Error('element not found: ' + ${safeSelector}); el.focus(); el.value = ${safeText}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`,
        );
        return ok(res);
      }

      if (path === '/query' && method === 'GET') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const selector = params.get('selector');
        if (!selector) return fail(res, 400, 'missing ?selector= parameter');
        const safeSelector = JSON.stringify(selector);
        const elements = await wc.executeJavaScript(
          `[...document.querySelectorAll(${safeSelector})].map(el => ({ tag: el.tagName.toLowerCase(), text: el.innerText?.slice(0, 500) ?? '', attributes: Object.fromEntries([...el.attributes].map(a => [a.name, a.value])) }))`,
        );
        return ok(res, { elements });
      }

      // ── Snapshot (accessibility-tree-like) ──────────────────────────
      if (path === '/snapshot' && method === 'GET') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const interactiveOnly = params.get('interactive_only') !== 'false';
        const maxDepth = parseInt(params.get('max_depth') || '5', 10);
        // Always use the real tab ID for ref storage — never '_active'
        const tabId = resolveEffectiveTabId(requestedTabId, browserService);
        if (!tabId) return fail(res, 400, 'no active tab');

        // Clear existing refs for this tab
        clearRefs(tabId);

        const rawResults: Array<{
          ref: string;
          tag: string;
          role: string;
          name: string;
          text: string;
          href: string;
          placeholder: string;
          value: string;
          type: string;
          selector: string;
        }> = await wc.executeJavaScript(`
          (() => {
            const interactive = 'a,button,input,select,textarea,[role=button],[role=link],[role=checkbox],[role=radio],[contenteditable=true]';
            const interactiveOnly = ${interactiveOnly};
            const maxDepth = ${maxDepth};
            const results = [];
            let counter = 0;

            function walk(node, depth) {
              if (depth > maxDepth) return;
              if (node.nodeType !== 1) return;
              const el = node;
              const tag = el.tagName.toLowerCase();
              if (tag === 'script' || tag === 'style' || tag === 'noscript') return;

              const isInteractive = el.matches && el.matches(interactive);
              if (interactiveOnly && !isInteractive) {
                for (const child of el.children) walk(child, depth + 1);
                return;
              }

              const ref = 'e' + (++counter);
              const role = el.getAttribute('role') || '';
              const name = el.getAttribute('aria-label') || el.getAttribute('name') || '';
              const text = (el.innerText || '').trim().slice(0, 200);
              const href = el.getAttribute('href') || '';
              const placeholder = el.getAttribute('placeholder') || '';
              const value = el.value !== undefined ? String(el.value) : '';
              const type = el.getAttribute('type') || '';

              // Build a unique selector for this element
              let selector = '';
              if (el.id) {
                selector = '#' + CSS.escape(el.id);
              } else {
                const path = [];
                let cur = el;
                while (cur && cur !== document.body) {
                  let seg = cur.tagName.toLowerCase();
                  if (cur.id) { path.unshift('#' + CSS.escape(cur.id)); break; }
                  const parent = cur.parentElement;
                  if (parent) {
                    const siblings = [...parent.children].filter(c => c.tagName === cur.tagName);
                    if (siblings.length > 1) seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
                  }
                  path.unshift(seg);
                  cur = cur.parentElement;
                }
                selector = path.join(' > ');
              }

              results.push({ ref, tag, role, name, text, href, placeholder, value, type, selector });

              if (!interactiveOnly) {
                for (const child of el.children) walk(child, depth + 1);
              }
            }

            walk(document.body, 0);
            return results;
          })()
        `);

        // Store ref -> selector mappings, then strip selector from response
        const refMap = getRefMap(tabId);
        const elements = rawResults.map(({ selector, ...rest }) => {
          refMap.set(rest.ref, selector);
          return rest;
        });

        // Include tab_id so callers can pass it to subsequent actions
        return ok(res, { tab_id: tabId, elements });
      }

      // ── Click by ref ────────────────────────────────────────────────
      if (path === '/click-ref' && method === 'POST') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const ref = params.get('ref');
        if (!ref) return fail(res, 400, 'missing ?ref= parameter');
        const tabId = resolveEffectiveTabId(requestedTabId, browserService);
        if (!tabId) return fail(res, 400, 'no active tab');
        const selector = resolveRef(tabId, ref);
        if (!selector) return fail(res, 400, `unknown ref: ${ref}`);
        const safeSelector = JSON.stringify(selector);
        await wc.executeJavaScript(
          `(() => { const el = document.querySelector(${safeSelector}); if (!el) throw new Error('element not found for ref ${ref}'); el.click(); })()`,
        );
        return ok(res);
      }

      // ── Type by ref ─────────────────────────────────────────────────
      if (path === '/type-ref' && method === 'POST') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const ref = params.get('ref');
        const text = params.get('text');
        const clear = params.get('clear') !== 'false';
        if (!ref) return fail(res, 400, 'missing ?ref= parameter');
        if (text === null) return fail(res, 400, 'missing ?text= parameter');
        const tabId = resolveEffectiveTabId(requestedTabId, browserService);
        if (!tabId) return fail(res, 400, 'no active tab');
        const selector = resolveRef(tabId, ref);
        if (!selector) return fail(res, 400, `unknown ref: ${ref}`);
        const safeSelector = JSON.stringify(selector);
        const safeText = JSON.stringify(text);
        await wc.executeJavaScript(
          `(() => { const el = document.querySelector(${safeSelector}); if (!el) throw new Error('element not found for ref ${ref}'); el.focus(); ${clear ? "el.value = '';" : ''} el.value = ${safeText}; el.dispatchEvent(new Event('input', { bubbles: true })); el.dispatchEvent(new Event('change', { bubbles: true })); })()`,
        );
        return ok(res);
      }

      // ── Scroll ──────────────────────────────────────────────────────
      if (path === '/scroll' && method === 'POST') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const direction = params.get('direction') || 'down';
        const amount = parseInt(params.get('amount') || '300', 10);
        const scrollRef = params.get('ref');
        const tabId = resolveEffectiveTabId(requestedTabId, browserService);
        if (!tabId) return fail(res, 400, 'no active tab');

        if (scrollRef) {
          const selector = resolveRef(tabId, scrollRef);
          if (!selector) return fail(res, 400, `unknown ref: ${scrollRef}`);
          const safeSelector = JSON.stringify(selector);
          await wc.executeJavaScript(
            `(() => { const el = document.querySelector(${safeSelector}); if (el) el.scrollIntoView({ behavior: 'smooth', block: 'center' }); })()`,
          );
        } else {
          let scrollX = 0;
          let scrollY = 0;
          switch (direction) {
            case 'up': scrollY = -amount; break;
            case 'down': scrollY = amount; break;
            case 'left': scrollX = -amount; break;
            case 'right': scrollX = amount; break;
          }
          await wc.executeJavaScript(`window.scrollBy(${scrollX}, ${scrollY})`);
        }
        return ok(res);
      }

      // ── Wait ────────────────────────────────────────────────────────
      if (path === '/wait' && method === 'POST') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const condition = params.get('condition');
        const value = params.get('value') || '';
        const timeoutMs = parseInt(params.get('timeout_ms') || '10000', 10);

        if (!condition) return fail(res, 400, 'missing ?condition= parameter');

        if (condition === 'ms') {
          const ms = parseInt(value || '1000', 10);
          await new Promise<void>((resolve) => setTimeout(resolve, ms));
          return ok(res, { waited: ms });
        }

        if (condition === 'networkidle') {
          // Simplified: wait 2 seconds for network to settle
          await new Promise<void>((resolve) => setTimeout(resolve, 2000));
          return ok(res, { waited: 2000 });
        }

        // Poll-based conditions: element, text, js
        const safeValue = JSON.stringify(value);
        let checkExpr: string;
        switch (condition) {
          case 'element':
            checkExpr = `!!document.querySelector(${safeValue})`;
            break;
          case 'text':
            checkExpr = `document.body.innerText.includes(${safeValue})`;
            break;
          case 'js':
            checkExpr = `!!(${value})`;
            break;
          default:
            return fail(res, 400, `unknown condition: ${condition}`);
        }

        const startTime = Date.now();
        while (Date.now() - startTime < timeoutMs) {
          const met = await wc.executeJavaScript(checkExpr);
          if (met) return ok(res, { elapsed: Date.now() - startTime });
          await new Promise<void>((resolve) => setTimeout(resolve, 200));
        }

        return fail(res, 408, `wait timeout after ${timeoutMs}ms for condition "${condition}"`);
      }

      // ── Find ────────────────────────────────────────────────────────
      if (path === '/find' && method === 'POST') {
        if (!wc) return fail(res, 400, requestedTabId ? `tab not found: ${requestedTabId}` : 'no active tab');
        const description = params.get('description');
        if (!description) return fail(res, 400, 'missing ?description= parameter');
        const tabId = resolveEffectiveTabId(requestedTabId, browserService);
        if (!tabId) return fail(res, 400, 'no active tab');
        const safeDesc = JSON.stringify(description.toLowerCase());

        const rawResults: Array<{
          ref: string;
          tag: string;
          role: string;
          name: string;
          text: string;
          href: string;
          placeholder: string;
          value: string;
          type: string;
          selector: string;
        }> = await wc.executeJavaScript(`
          (() => {
            const desc = ${safeDesc};
            const results = [];
            let counter = 0;
            const all = document.querySelectorAll('*');
            for (const el of all) {
              const tag = el.tagName.toLowerCase();
              if (tag === 'script' || tag === 'style' || tag === 'noscript') continue;

              const innerText = (el.innerText || '').trim().slice(0, 200).toLowerCase();
              const ariaLabel = (el.getAttribute('aria-label') || '').toLowerCase();
              const placeholder = (el.getAttribute('placeholder') || '').toLowerCase();
              const title = (el.getAttribute('title') || '').toLowerCase();
              const nameAttr = (el.getAttribute('name') || '').toLowerCase();

              const match = innerText.includes(desc) ||
                ariaLabel.includes(desc) ||
                placeholder.includes(desc) ||
                title.includes(desc) ||
                nameAttr.includes(desc);

              if (!match) continue;

              const ref = 'e' + (++counter);
              const role = el.getAttribute('role') || '';
              const name = el.getAttribute('aria-label') || el.getAttribute('name') || '';
              const text = (el.innerText || '').trim().slice(0, 200);
              const href = el.getAttribute('href') || '';
              const value = el.value !== undefined ? String(el.value) : '';
              const type = el.getAttribute('type') || '';

              // Build a unique selector
              let selector = '';
              if (el.id) {
                selector = '#' + CSS.escape(el.id);
              } else {
                const path = [];
                let cur = el;
                while (cur && cur !== document.body) {
                  let seg = cur.tagName.toLowerCase();
                  if (cur.id) { path.unshift('#' + CSS.escape(cur.id)); break; }
                  const parent = cur.parentElement;
                  if (parent) {
                    const siblings = [...parent.children].filter(c => c.tagName === cur.tagName);
                    if (siblings.length > 1) seg += ':nth-of-type(' + (siblings.indexOf(cur) + 1) + ')';
                  }
                  path.unshift(seg);
                  cur = cur.parentElement;
                }
                selector = path.join(' > ');
              }

              results.push({ ref, tag, role, name, text, href, placeholder: el.getAttribute('placeholder') || '', value, type, selector });
              if (results.length >= 20) break;
            }
            return results;
          })()
        `);

        // Store ref -> selector mappings, then strip selector from response
        const refMap = getRefMap(tabId);
        const elements = rawResults.map(({ selector, ...rest }) => {
          refMap.set(rest.ref, selector);
          return rest;
        });

        return ok(res, { tab_id: tabId, elements });
      }

      // ── 404 ─────────────────────────────────────────────────────────
      fail(res, 404, `unknown endpoint: ${method} ${path}`);
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err);
      fail(res, 500, message);
    }
  });

  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`[browser-bridge] port ${listenPort} already in use. Set BROWSER_BRIDGE_PORT env var to use a different port.`);
    } else {
      console.error(`[browser-bridge] server error:`, err);
    }
  });

  server.listen(listenPort, '127.0.0.1', () => {
    console.log(`[browser-bridge] listening on 127.0.0.1:${listenPort}`);
  });
}
