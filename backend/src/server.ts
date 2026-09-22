import { existsSync } from 'node:fs';
import { createServer } from 'node:http';
import path from 'node:path';
import { createApp } from './app.ts';
import { authenticatorFor } from './auth.ts';
import { loadConfig } from './config.ts';
import { LayoutStore } from './layouts.ts';
import { RateLimiter } from './rateLimit.ts';
import { SessionStore } from './sessions.ts';

const MINUTE_MS = 60_000;
const REQUESTS_PER_MINUTE = 300;
const LOGINS_PER_MINUTE = 10;
const CHATS_PER_MINUTE = 20;

// Local development: backend/.env holds server settings, the repo-root .env holds
// shared secrets such as the LLM gateway key. Neither overrides variables already set.
for (const file of [path.resolve(import.meta.dirname, '../../.env'), path.resolve(import.meta.dirname, '../.env')]) {
  if (existsSync(file)) process.loadEnvFile(file);
}

// A cluster with a self-signed certificate: trust its CA (verification stays on).
if (process.env['CLUSTER_CA_FILE'] && !process.env['NODE_EXTRA_CA_CERTS']) {
  console.log('CLUSTER_CA_FILE is set; start with NODE_EXTRA_CA_CERTS=<that file> so Node trusts the cluster certificate.');
}

const config = loadConfig();
const layouts = new LayoutStore(config.dataDir);
await layouts.init();

const sessions = new SessionStore(config.sessionTtlMs, Date.now, path.join(config.dataDir, 'sessions.json'));
const limiter = new RateLimiter(REQUESTS_PER_MINUTE, MINUTE_MS);
const loginLimiter = new RateLimiter(LOGINS_PER_MINUTE, MINUTE_MS);
const chatLimiter = new RateLimiter(CHATS_PER_MINUTE, MINUTE_MS);

const app = createApp({ config, auth: authenticatorFor(config), sessions, layouts, limiter, loginLimiter, chatLimiter });

setInterval(() => {
  sessions.sweep();
  limiter.sweep();
  loginLimiter.sweep();
  chatLimiter.sweep();
}, MINUTE_MS).unref();

createServer((req, res) => {
  void app(req, res);
}).listen(config.port, config.host, () => {
  const mode = [config.devUsers.size > 0 ? 'dev tokens' : null, config.thoughtSpotHost ? 'ThoughtSpot' : null]
    .filter(Boolean)
    .join(' + ');
  console.log(
    `spot-canvas api listening on http://${config.host}:${config.port} (auth: ${mode}; chat: ${config.gateway ? config.gateway.model : 'disabled'})`
  );
});
