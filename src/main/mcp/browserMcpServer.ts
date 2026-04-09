/**
 * MCP Browser Server for Codex
 *
 * Standalone Node.js script that acts as an MCP STDIO server.
 * Codex CLI spawns this as a subprocess and communicates via MCP/STDIO.
 * Each tool handler forwards requests to the browser bridge HTTP server.
 *
 * Architecture:
 *   Codex CLI --(MCP/STDIO)--> browserMcpServer.js --(HTTP)--> browserBridge (port 3111)
 */

import * as http from 'http';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';

// ── Bridge HTTP helper ──────────────────────────────────────────────────────

const BRIDGE_PORT = Number(process.env.BROWSER_BRIDGE_PORT) || 3111;
const BRIDGE_BASE = `http://127.0.0.1:${BRIDGE_PORT}`;

function bridgeRequest(
  path: string,
  method = 'GET',
  body?: string,
  timeoutMs = 15_000,
): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = new URL(path, BRIDGE_BASE);
    const opts: http.RequestOptions = {
      hostname: url.hostname,
      port: url.port,
      path: url.pathname + url.search,
      method,
      headers: body
        ? { 'Content-Type': 'text/plain', 'Content-Length': Buffer.byteLength(body) }
        : undefined,
    };

    const req = http.request(opts, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    });

    req.on('error', reject);
    req.setTimeout(timeoutMs, () => {
      req.destroy();
      reject(new Error('bridge timeout'));
    });

    if (body) req.write(body);
    req.end();
  });
}

/** Call bridge, return text content for MCP. On error, return error text instead of throwing. */
async function callBridge(
  path: string,
  method = 'GET',
  body?: string,
  timeoutMs?: number,
): Promise<{ content: Array<{ type: 'text'; text: string }> }> {
  try {
    const raw = await bridgeRequest(path, method, body, timeoutMs);
    return { content: [{ type: 'text' as const, text: raw }] };
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    return { content: [{ type: 'text' as const, text: `ERROR: ${msg}` }] };
  }
}

// ── MCP Server ──────────────────────────────────────────────────────────────

const server = new McpServer({
  name: 'clawdia-browser',
  version: '1.0.0',
});

// ── Helper: build query string with optional tabId ─────────────────────────

function withTab(path: string, tabId?: string, extra?: Record<string, string>): string {
  const params = new URLSearchParams();
  if (tabId) params.set('tabId', tabId);
  if (extra) for (const [k, v] of Object.entries(extra)) params.set(k, v);
  const qs = params.toString();
  return qs ? `${path}?${qs}` : path;
}

// ── Tool 1: browser_navigate ────────────────────────────────────────────────

server.tool(
  'browser_navigate',
  'Navigate the browser to a URL, or use "back"/"forward" for history navigation',
  {
    url: z.string().describe('URL to navigate to, or "back" or "forward"'),
    tab_id: z.string().optional().describe('Target tab ID. If omitted, uses the active tab'),
  },
  async ({ url, tab_id }) => {
    if (url === 'back') return callBridge('/back');
    if (url === 'forward') return callBridge('/forward');
    return callBridge(withTab('/navigate', tab_id, { url }));
  },
);

// ── Tool 2: browser_snapshot ────────────────────────────────────────────────

server.tool(
  'browser_snapshot',
  'Get an accessibility-tree-like snapshot of the current page with interactive element refs. Returns a tab_id that should be passed to subsequent click/type/scroll actions to ensure they target the same tab.',
  {
    interactive_only: z
      .boolean()
      .optional()
      .describe('Only return interactive elements (default true)'),
    max_depth: z.number().optional().describe('Max DOM depth to traverse (default 5)'),
    tab_id: z.string().optional().describe('Target tab ID. If omitted, uses the active tab'),
  },
  async ({ interactive_only, max_depth, tab_id }) => {
    const extra: Record<string, string> = {};
    if (interactive_only !== undefined) extra.interactive_only = String(interactive_only);
    if (max_depth !== undefined) extra.max_depth = String(max_depth);
    return callBridge(withTab('/snapshot', tab_id, extra));
  },
);

// ── Tool 3: browser_click ───────────────────────────────────────────────────

server.tool(
  'browser_click',
  'Click an element by its ref ID (from browser_snapshot)',
  {
    ref: z.string().describe('Element ref ID from snapshot (e.g. "e3")'),
    tab_id: z.string().optional().describe('Tab ID from the snapshot response. Pass this to ensure the click targets the correct tab'),
  },
  async ({ ref, tab_id }) => {
    return callBridge(withTab('/click-ref', tab_id, { ref }), 'POST');
  },
);

// ── Tool 4: browser_type ────────────────────────────────────────────────────

server.tool(
  'browser_type',
  'Type text into an input element by its ref ID',
  {
    ref: z.string().describe('Element ref ID from snapshot'),
    text: z.string().describe('Text to type'),
    clear: z.boolean().optional().describe('Clear existing value first (default true)'),
    tab_id: z.string().optional().describe('Tab ID from the snapshot response'),
  },
  async ({ ref, text, clear, tab_id }) => {
    const extra: Record<string, string> = { ref, text };
    if (clear !== undefined) extra.clear = String(clear);
    return callBridge(withTab('/type-ref', tab_id, extra), 'POST');
  },
);

// ── Tool 5: browser_scroll ──────────────────────────────────────────────────

server.tool(
  'browser_scroll',
  'Scroll the page or scroll an element into view',
  {
    direction: z
      .string()
      .describe('Scroll direction: "up", "down", "left", or "right"'),
    amount: z.number().optional().describe('Scroll amount in pixels (default 300)'),
    ref: z
      .string()
      .optional()
      .describe('If provided, scroll this element into view instead of page scroll'),
    tab_id: z.string().optional().describe('Tab ID from the snapshot response'),
  },
  async ({ direction, amount, ref, tab_id }) => {
    const extra: Record<string, string> = { direction };
    if (amount !== undefined) extra.amount = String(amount);
    if (ref !== undefined) extra.ref = ref;
    return callBridge(withTab('/scroll', tab_id, extra), 'POST');
  },
);

// ── Tool 6: browser_wait ────────────────────────────────────────────────────

server.tool(
  'browser_wait',
  'Wait for a condition: "element" (CSS selector), "text" (text on page), "js" (expression), "ms" (delay), or "networkidle"',
  {
    condition: z
      .string()
      .describe('Condition type: "element", "text", "js", "ms", or "networkidle"'),
    value: z.string().describe('Condition value (selector, text, expression, or ms)'),
    timeout_ms: z
      .number()
      .optional()
      .describe('Max wait time in ms (default 10000)'),
    tab_id: z.string().optional().describe('Target tab ID'),
  },
  async ({ condition, value, timeout_ms, tab_id }) => {
    const extra: Record<string, string> = { condition, value };
    if (timeout_ms !== undefined) extra.timeout_ms = String(timeout_ms);
    const waitTimeout = timeout_ms ? timeout_ms + 5000 : 20_000;
    return callBridge(withTab('/wait', tab_id, extra), 'POST', undefined, waitTimeout);
  },
);

// ── Tool 7: browser_screenshot ──────────────────────────────────────────────

server.tool(
  'browser_screenshot',
  'Take a screenshot of the current page',
  {
    save_path: z
      .string()
      .optional()
      .describe('File path to save PNG. If omitted, returns base64'),
    tab_id: z.string().optional().describe('Target tab ID'),
  },
  async ({ save_path, tab_id }) => {
    const extra: Record<string, string> = {};
    if (save_path) extra.path = save_path;
    return callBridge(withTab('/screenshot', tab_id, extra));
  },
);

// ── Tool 8: browser_get_text ────────────────────────────────────────────────

server.tool(
  'browser_get_text',
  'Get the full text content of the current page',
  {
    tab_id: z.string().optional().describe('Target tab ID'),
  },
  async ({ tab_id }) => {
    return callBridge(withTab('/page-text', tab_id));
  },
);

// ── Tool 9: browser_tabs ────────────────────────────────────────────────────

server.tool(
  'browser_tabs',
  'Manage browser tabs: "list", "new", "switch", or "close"',
  {
    action: z
      .string()
      .describe('Tab action: "list", "new", "switch", or "close"'),
    tab_id: z
      .string()
      .optional()
      .describe('Tab ID for "switch" or "close" actions'),
    url: z.string().optional().describe('URL for "new" tab action'),
  },
  async ({ action, tab_id, url }) => {
    switch (action) {
      case 'list':
        return callBridge('/tabs');
      case 'new': {
        const params = new URLSearchParams();
        if (url) params.set('url', url);
        const qs = params.toString();
        return callBridge(`/tabs/new${qs ? '?' + qs : ''}`, 'POST');
      }
      case 'switch': {
        if (!tab_id) {
          return {
            content: [{ type: 'text' as const, text: 'ERROR: tab_id is required for switch' }],
          };
        }
        return callBridge(`/tabs/switch?id=${encodeURIComponent(tab_id)}`, 'POST');
      }
      case 'close': {
        if (!tab_id) {
          return {
            content: [{ type: 'text' as const, text: 'ERROR: tab_id is required for close' }],
          };
        }
        return callBridge(`/tabs/close?id=${encodeURIComponent(tab_id)}`, 'POST');
      }
      default:
        return {
          content: [
            {
              type: 'text' as const,
              text: `ERROR: unknown tab action "${action}". Use "list", "new", "switch", or "close"`,
            },
          ],
        };
    }
  },
);

// ── Tool 10: browser_execute_js ─────────────────────────────────────────────

server.tool(
  'browser_execute_js',
  'Execute JavaScript code in the browser page context',
  {
    code: z.string().describe('JavaScript code to execute'),
    tab_id: z.string().optional().describe('Target tab ID'),
  },
  async ({ code, tab_id }) => {
    return callBridge(withTab('/execute-js', tab_id), 'POST', code);
  },
);

// ── Tool 11: browser_extract_links ──────────────────────────────────────────

server.tool(
  'browser_extract_links',
  'Extract external links from the current page',
  {
    tab_id: z.string().optional().describe('Target tab ID'),
  },
  async ({ tab_id }) => {
    return callBridge(withTab('/extract-links', tab_id));
  },
);

// ── Tool 12: browser_find ───────────────────────────────────────────────────

server.tool(
  'browser_find',
  'Find elements on the page by text description',
  {
    description: z.string().describe('Text description to search for in element content, labels, and attributes'),
    tab_id: z.string().optional().describe('Target tab ID'),
  },
  async ({ description, tab_id }) => {
    return callBridge(withTab('/find', tab_id, { description }), 'POST');
  },
);

// ── Start ───────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  const transport = new StdioServerTransport();
  await server.connect(transport);
  // Log to stderr so it doesn't interfere with MCP STDIO protocol on stdout
  process.stderr.write('[mcp-browser] server started on stdio\n');
}

main().catch((err) => {
  process.stderr.write(`[mcp-browser] fatal: ${err}\n`);
  process.exit(1);
});
