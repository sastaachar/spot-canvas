import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AgentError, runChat, type ChatMessage } from './agent/chat.ts';
import { applyTool, CataloguePluginSchema, TOOLS, type ToolContext } from './agent/tools.ts';
import { CatalogueSchema, type CatalogueStore } from './catalogue.ts';
import type { TokenStore } from './tokens.ts';
import { ClusterUrlError, loginToCluster, UpstreamError, type Authenticator, type ClusterSession, type FetchLike } from './auth.ts';
import type { Config, Identity } from './config.ts';
import { applyBaseHeaders, clientIp, HttpError, readJson, sendEmpty, sendJson } from './http.ts';
import { LayoutSchema, type Layout, type LayoutStore } from './layouts.ts';
import type { RateLimiter } from './rateLimit.ts';
import { clearSessionCookie, parseCookies, SESSION_COOKIE, sessionCookie, type SessionStore } from './sessions.ts';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'SpotCanvas';

const MAX_TOKEN_LENGTH = 4096;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const MAX_CREDENTIAL_LENGTH = 512;

const LoginSchema = z.union([
  z.object({ token: z.string().min(1).max(MAX_TOKEN_LENGTH) }),
  z.object({
    clusterUrl: z.string().min(1).max(MAX_CREDENTIAL_LENGTH),
    username: z.string().min(1).max(MAX_CREDENTIAL_LENGTH),
    password: z.string().min(1).max(MAX_CREDENTIAL_LENGTH)
  })
]);

const MAX_CHAT_MESSAGE = 4000;
const MAX_CHAT_HISTORY = 20;
const MAX_CATALOGUE = 200;

const ChatSchema = z.object({
  message: z.string().min(1).max(MAX_CHAT_MESSAGE),
  history: z
    .array(z.object({ role: z.enum(['user', 'assistant']), content: z.string().max(MAX_CHAT_MESSAGE) }))
    .max(MAX_CHAT_HISTORY)
    .default([]),
  catalogue: z.array(CataloguePluginSchema).max(MAX_CATALOGUE).default([])
});

const EMPTY_LAYOUT: Layout = { version: 2, panels: [], suites: {}, groups: [], preferences: {} };

export type Logger = (message: string, error?: unknown) => void;

export interface AppDeps {
  config: Config;
  auth: Authenticator;
  sessions: SessionStore;
  layouts: LayoutStore;
  limiter: RateLimiter;
  loginLimiter: RateLimiter;
  chatLimiter: RateLimiter;
  tokens: TokenStore;
  catalogues: CatalogueStore;
  gatewayFetch?: FetchLike;
  clusterFetch?: FetchLike;
  log?: Logger;
}

const TokenRequestSchema = z.object({ label: z.string().min(1).max(60).default('MCP') });
const TOOL_NAMES = new Set(TOOLS.map((t) => t.function.name));
const BEARER = /^Bearer\s+(\S+)$/i;

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const userView = (identity: Identity) => ({
  id: identity.id,
  name: identity.name,
  displayName: identity.displayName,
  cluster: identity.cluster ?? null
});

export function createApp(deps: AppDeps): Handler {
  const { config, log = (message, error) => console.error(message, error) } = deps;

  const applyCors = (req: IncomingMessage, res: ServerResponse): boolean => {
    const origin = req.headers.origin;
    if (!origin) return true;
    if (origin !== config.frontendOrigin) return false;
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, DELETE, OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With');
    res.setHeader('Vary', 'Origin');
    return true;
  };

  const currentSession = (req: IncomingMessage): { sid: string | null; identity: Identity | null } => {
    const sid = parseCookies(req.headers.cookie).get(SESSION_COOKIE);
    if (!sid) return { sid: null, identity: null };
    return { sid, identity: deps.sessions.get(sid) };
  };

  const startSession = (res: ServerResponse, identity: Identity, cluster: ClusterSession | null = null): void => {
    const sid = deps.sessions.create(identity, cluster);
    res.setHeader('Set-Cookie', sessionCookie(sid, config.sessionTtlMs, config.cookieSecure));
  };

  // Local development only: with DEV_DEFAULT_USER set, a request without a session is
  // treated as that dev user so the homepage opens without a sign-in step.
  const bearerIdentity = (req: IncomingMessage): Identity | null => {
    const match = BEARER.exec(req.headers.authorization ?? '');
    return match?.[1] ? deps.tokens.resolve(match[1]) : null;
  };

  const identityOrDevDefault = (req: IncomingMessage, res: ServerResponse): Identity | null => {
    const bearer = bearerIdentity(req);
    if (bearer) return bearer;
    const { identity } = currentSession(req);
    if (identity || !config.devDefaultUserId) return identity;
    const fallback = [...config.devUsers.values()].find((u) => u.id === config.devDefaultUserId) ?? null;
    if (fallback) startSession(res, fallback);
    return fallback;
  };

  return async (req, res) => {
    applyBaseHeaders(res);
    try {
      const method = req.method ?? 'GET';
      const pathname = new URL(req.url ?? '/', 'http://localhost').pathname;

      if (!applyCors(req, res)) throw new HttpError(403, 'origin_not_allowed');
      if (method === 'OPTIONS') return sendEmpty(res, 204);
      if (!deps.limiter.allow(clientIp(req))) throw new HttpError(429, 'rate_limited');
      if (MUTATING_METHODS.has(method) && req.headers[CSRF_HEADER] !== CSRF_VALUE && !BEARER.test(req.headers.authorization ?? '')) {
        throw new HttpError(403, 'missing_csrf_header');
      }

      if (pathname === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true });

      if ((pathname === '/api/login' || pathname === '/api/session') && method === 'POST') {
        if (!deps.loginLimiter.allow(clientIp(req))) throw new HttpError(429, 'rate_limited');
        const body = LoginSchema.safeParse(await readJson(req));
        if (!body.success) throw new HttpError(400, 'invalid_body');
        if ('token' in body.data) {
          const identity = await deps.auth.authenticate(body.data.token);
          if (!identity) throw new HttpError(401, 'invalid_token');
          startSession(res, identity);
          return sendJson(res, 200, { user: userView(identity) });
        }
        const login = await loginToCluster(body.data, deps.clusterFetch);
        if (!login) throw new HttpError(401, 'invalid_credentials');
        startSession(res, login.identity, login.cluster);
        return sendJson(res, 200, { user: userView(login.identity) });
      }

      if ((pathname === '/api/logout' && method === 'POST') || (pathname === '/api/session' && method === 'DELETE')) {
        const { sid } = currentSession(req);
        if (sid) deps.sessions.delete(sid);
        res.setHeader('Set-Cookie', clearSessionCookie(config.cookieSecure));
        return sendEmpty(res, 204);
      }

      const identity = identityOrDevDefault(req, res);
      if (!identity) throw new HttpError(401, 'unauthenticated');
      const sid = parseCookies(req.headers.cookie).get(SESSION_COOKIE) ?? null;
      // Keep signed-in users signed in: slide the expiry and refresh the cookie as they use the page.
      if (sid && deps.sessions.touch(sid)) res.setHeader('Set-Cookie', sessionCookie(sid, config.sessionTtlMs, config.cookieSecure));

      if (pathname === '/api/me' && method === 'GET') return sendJson(res, 200, { user: userView(identity) });

      if (pathname === '/api/layout' && method === 'GET') {
        const layout = await deps.layouts.read(identity.id);
        return layout ? sendJson(res, 200, layout) : sendEmpty(res, 204);
      }

      if (pathname === '/api/layout' && method === 'PUT') {
        const parsed = LayoutSchema.safeParse(await readJson(req));
        if (!parsed.success) throw new HttpError(400, 'invalid_layout');
        await deps.layouts.write(identity.id, parsed.data);
        return sendEmpty(res, 204);
      }

      if (pathname === '/api/tokens' && method === 'POST') {
        const parsed = TokenRequestSchema.safeParse((await readJson(req).catch(() => ({}))) ?? {});
        if (!parsed.success) throw new HttpError(400, 'invalid_body');
        const token = deps.tokens.create(identity, parsed.data.label);
        return sendJson(res, 201, { token, label: parsed.data.label, tokens: deps.tokens.list(identity.id) });
      }

      if (pathname === '/api/tokens' && method === 'GET') return sendJson(res, 200, { tokens: deps.tokens.list(identity.id) });

      if (pathname === '/api/tokens' && method === 'DELETE') {
        return sendJson(res, 200, { revoked: deps.tokens.revokeAll(identity.id) });
      }

      if (pathname === '/api/catalogue' && method === 'PUT') {
        const parsed = CatalogueSchema.safeParse(await readJson(req));
        if (!parsed.success) throw new HttpError(400, 'invalid_catalogue');
        await deps.catalogues.write(identity.id, parsed.data);
        return sendEmpty(res, 204);
      }

      if (pathname === '/api/tools' && method === 'GET') {
        return sendJson(res, 200, { tools: TOOLS.map((t) => t.function) });
      }

      if (pathname.startsWith('/api/tools/') && method === 'POST') {
        const name = pathname.slice('/api/tools/'.length);
        if (!TOOL_NAMES.has(name)) throw new HttpError(404, 'unknown_tool');
        const args = (await readJson(req).catch(() => ({}))) ?? {};
        const layout = structuredClone((await deps.layouts.read(identity.id)) ?? EMPTY_LAYOUT);
        const ctx: ToolContext = { layout, catalogue: await deps.catalogues.read(identity.id) };
        const outcome = await applyTool(name, args, ctx);
        if (outcome.changed) await deps.layouts.write(identity.id, layout);
        return sendJson(res, 200, { result: outcome.result, changed: outcome.changed, summary: outcome.summary ?? null });
      }

      if (pathname === '/api/chat' && method === 'POST') {
        if (!config.gateway) throw new HttpError(503, 'chat_disabled');
        if (!deps.chatLimiter.allow(clientIp(req))) throw new HttpError(429, 'rate_limited');
        const parsed = ChatSchema.safeParse(await readJson(req));
        if (!parsed.success) throw new HttpError(400, 'invalid_body');
        const layout = (await deps.layouts.read(identity.id)) ?? EMPTY_LAYOUT;
        const catalogue = parsed.data.catalogue.length > 0 ? parsed.data.catalogue : await deps.catalogues.read(identity.id);
        const result = await runChat(
          {
            message: parsed.data.message,
            history: parsed.data.history as ChatMessage[],
            catalogue,
            layout,
            user: identity,
            cluster: sid ? deps.sessions.cluster(sid) : null
          },
          config.gateway,
          { fetchImpl: deps.gatewayFetch, clusterFetch: deps.clusterFetch }
        );
        if (result.changed) await deps.layouts.write(identity.id, result.layout);
        return sendJson(res, 200, {
          reply: result.reply,
          changed: result.changed,
          actions: result.actions,
          ...(result.changed ? { layout: result.layout } : {})
        });
      }

      throw new HttpError(404, 'not_found');
    } catch (error) {
      if (error instanceof HttpError) return sendJson(res, error.status, { error: error.code });
      if (error instanceof ClusterUrlError) return sendJson(res, 400, { error: 'invalid_cluster_url', message: error.message });
      if (error instanceof UpstreamError) {
        log('authentication upstream failed', error);
        return sendJson(res, 502, { error: 'auth_unavailable' });
      }
      if (error instanceof AgentError) {
        log('chat agent failed', error);
        return sendJson(res, 502, { error: 'agent_unavailable' });
      }
      log('unhandled request error', error);
      return sendJson(res, 500, { error: 'internal_error' });
    }
  };
}
