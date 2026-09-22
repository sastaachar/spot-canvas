// Minimal MCP (Model Context Protocol) server over stdio. It proxies tool calls to a
// running Spot Canvas backend using a personal token, so Claude Desktop, Claude Code or
// any MCP client can edit the homepage with the same tools Spotter uses.
//
//   SPOT_CANVAS_URL=http://127.0.0.1:8787 SPOT_CANVAS_TOKEN=sc_... node dist/mcp/server.js
import { createInterface } from 'node:readline';
import { handleMcpMessage, type McpDeps } from './protocol.ts';

const url = process.env['SPOT_CANVAS_URL']?.replace(/\/+$/, '');
const token = process.env['SPOT_CANVAS_TOKEN'];
if (!url || !token) {
  console.error('Set SPOT_CANVAS_URL and SPOT_CANVAS_TOKEN (create a token from the profile sheet in Spot Canvas).');
  process.exit(2);
}

const deps: McpDeps = { baseUrl: url, token, fetchImpl: fetch };
const out = (message: unknown) => process.stdout.write(`${JSON.stringify(message)}\n`);

createInterface({ input: process.stdin }).on('line', (line) => {
  if (!line.trim()) return;
  void handleMcpMessage(line, deps).then((reply) => {
    if (reply) out(reply);
  });
});
