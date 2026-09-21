import { createServer } from 'node:http';
import { createApp } from './app.ts';
import { authenticatorFor } from './auth.ts';
import { loadConfig } from './config.ts';
import { LayoutStore } from './layouts.ts';
import { RateLimiter } from './rateLimit.ts';
import { SessionStore } from './sessions.ts';

const MINUTE_MS = 60_000;
const REQUESTS_PER_MINUTE = 300;
const LOGINS_PER_MINUTE = 10;

const config = loadConfig();
const layouts = new LayoutStore(config.dataDir);
await layouts.init();

const sessions = new SessionStore(config.sessionTtlMs);
const limiter = new RateLimiter(REQUESTS_PER_MINUTE, MINUTE_MS);
const loginLimiter = new RateLimiter(LOGINS_PER_MINUTE, MINUTE_MS);

const app = createApp({ config, auth: authenticatorFor(config), sessions, layouts, limiter, loginLimiter });

setInterval(() => {
  sessions.sweep();
  limiter.sweep();
  loginLimiter.sweep();
}, MINUTE_MS).unref();

createServer((req, res) => {
  void app(req, res);
}).listen(config.port, config.host, () => {
  const mode = [config.devUsers.size > 0 ? 'dev tokens' : null, config.thoughtSpotHost ? 'ThoughtSpot' : null]
    .filter(Boolean)
    .join(' + ');
  console.log(`spot-canvas api listening on http://${config.host}:${config.port} (auth: ${mode})`);
});
