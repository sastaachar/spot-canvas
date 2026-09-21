import fs from 'node:fs';
import https from 'node:https';
import path from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vitest/config';

// Dev-only proxy for the ThoughtSpot chart plugin: `/prism` -> a locally running prism
// (PRISM_URL), authenticated with a cluster bearer token minted from trusted-auth
// credentials in a viz-embed style .dev.vars (TS_DEV_VARS; TS_HOST, TS_USERNAME,
// TS_SECRET_KEY or TS_TOKEN, optional .cluster-ca.pem next to it).
const DEV_VARS = process.env.TS_DEV_VARS ?? path.resolve(import.meta.dirname, '../../../viz-embed/.dev.vars');
const PRISM_URL = process.env.PRISM_URL ?? 'http://localhost:4124';
const TOKEN_TTL_MS = 50 * 60 * 1000;

function readDevVars(): Record<string, string> {
  const out: Record<string, string> = {};
  if (!fs.existsSync(DEV_VARS)) return out;
  for (const line of fs.readFileSync(DEV_VARS, 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m?.[1] && m[2] !== undefined) out[m[1]] = m[2].replace(/^["']|["']$/g, '');
  }
  return out;
}

/** Mints a trusted-auth bearer token (POST auth/token/full), cached for TOKEN_TTL_MS. */
function tokenMinter(): () => Promise<string> {
  const vars = readDevVars();
  const caPath = path.join(path.dirname(DEV_VARS), '.cluster-ca.pem');
  const ca = fs.existsSync(caPath) ? fs.readFileSync(caPath, 'utf8') : undefined;
  let token = vars.TS_TOKEN ?? '';
  let mintedAt = token ? Date.now() : 0;
  return () =>
    new Promise((resolve, reject) => {
      if (token && Date.now() - mintedAt < TOKEN_TTL_MS) return resolve(token);
      if (!vars.TS_HOST || !vars.TS_USERNAME || !vars.TS_SECRET_KEY) return resolve(token);
      const body = JSON.stringify({ username: vars.TS_USERNAME, secret_key: vars.TS_SECRET_KEY, validity_time_in_sec: 3600 });
      const req = https.request(
        new URL('/api/rest/2.0/auth/token/full', vars.TS_HOST),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Accept: 'application/json', 'Content-Length': Buffer.byteLength(body) },
          agent: ca ? new https.Agent({ ca, checkServerIdentity: () => undefined }) : undefined
        },
        (res) => {
          let data = '';
          res.on('data', (chunk) => {
            data += chunk;
          });
          res.on('end', () => {
            try {
              token = JSON.parse(data).token;
              mintedAt = Date.now();
              resolve(token);
            } catch (error) {
              reject(error);
            }
          });
        }
      );
      req.on('error', reject);
      req.end(body);
    });
}

/** Attaches the minted token to requests before the proxy forwards them. */
function thoughtspotTokenPlugin(): Plugin {
  const getToken = tokenMinter();
  return {
    name: 'thoughtspot-dev-token',
    configureServer(server) {
      server.middlewares.use(async (req, _res, next) => {
        if (req.url?.startsWith('/prism')) {
          try {
            (req as { tsToken?: string }).tsToken = await getToken();
          } catch (error) {
            console.error('[thoughtspot-dev-token]', error);
          }
        }
        next();
      });
    }
  };
}

export default defineConfig({
  plugins: [react(), thoughtspotTokenPlugin()],
  base: './',
  server: {
    port: 5173,
    strictPort: true,
    proxy: {
      '/prism': {
        target: PRISM_URL,
        changeOrigin: true,
        configure(proxy) {
          proxy.on('proxyReq', (proxyReq, req) => {
            const token = (req as { tsToken?: string }).tsToken;
            if (token) proxyReq.setHeader('Authorization', `Bearer ${token}`);
          });
        }
      }
    }
  },
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: ['src/main.tsx', 'src/**/*.d.ts', 'src/**/*.test.{ts,tsx}']
    }
  }
});
