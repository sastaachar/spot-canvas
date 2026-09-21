import type { IncomingMessage, ServerResponse } from 'node:http';
import { z } from 'zod';
import { AgentError, runChat, type ChatMessage } from './agent/chat.ts';
import { CataloguePluginSchema } from './agent/tools.ts';
import { UpstreamError, type Authenticator, type FetchLike } from './auth.ts';
import type { Config, Identity } from './config.ts';
import { applyBaseHeaders, clientIp, HttpError, readJson, sendEmpty, sendJson } from './http.ts';
import { LayoutSchema, type Layout, type LayoutStore } from './layouts.ts';
import type { RateLimiter } from './rateLimit.ts';
import { clearSessionCookie, parseCookies, SESSION_COOKIE, sessionCookie, type SessionStore } from './sessions.ts';

export const CSRF_HEADER = 'x-requested-with';
export const CSRF_VALUE = 'SpotCanvas';

const MAX_TOKEN_LENGTH = 4096;
const MUTATING_METHODS = new Set(['POST', 'PUT', 'PATCH', 'DELETE']);

const LoginSchema = z.object({ token: z.string().min(1).max(MAX_TOKEN_LENGTH) });

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

const EMPTY_LAYOUT: Layout = { version: 1, panels: [], suites: {}, groups: [], preferences: {} };

export type Logger = (message: string, error?: unknown) => void;

export interface AppDeps {
  config: Config;
  auth: Authenticator;
  sessions: SessionStore;
  layouts: LayoutStore;
  limiter: RateLimiter;
  loginLimiter: RateLimiter;
  chatLimiter: RateLimiter;
  gatewayFetch?: FetchLike;
  log?: Logger;
}

export type Handler = (req: IncomingMessage, res: ServerResponse) => Promise<void>;

const userView = (identity: Identity) => ({
  id: identity.id,
  name: identity.name,
  displayName: identity.displayName
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

  const startSession = (res: ServerResponse, identity: Identity): void => {
    const sid = deps.sessions.create(identity);
    res.setHeader('Set-Cookie', sessionCookie(sid, config.sessionTtlMs, config.cookieSecure));
  };

  // Local development only: with DEV_DEFAULT_USER set, a request without a session is
  // treated as that dev user so the homepage opens without a sign-in step.
  const identityOrDevDefault = (req: IncomingMessage, res: ServerResponse): Identity | null => {
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
      if (MUTATING_METHODS.has(method) && req.headers[CSRF_HEADER] !== CSRF_VALUE) {
        throw new HttpError(403, 'missing_csrf_header');
      }

      if (pathname === '/api/health' && method === 'GET') return sendJson(res, 200, { ok: true });

      if (pathname === '/api/session' && method === 'POST') {
        if (!deps.loginLimiter.allow(clientIp(req))) throw new HttpError(429, 'rate_limited');
        const body = LoginSchema.safeParse(await readJson(req));
        if (!body.success) throw new HttpError(400, 'invalid_body');
        const identity = await deps.auth.authenticate(body.data.token);
        if (!identity) throw new HttpError(401, 'invalid_token');
        startSession(res, identity);
        return sendJson(res, 200, { user: userView(identity) });
      }

      if (pathname === '/api/session' && method === 'DELETE') {
        const { sid } = currentSession(req);
        if (sid) deps.sessions.delete(sid);
        res.setHeader('Set-Cookie', clearSessionCookie(config.cookieSecure));
        return sendEmpty(res, 204);
      }

      const identity = identityOrDevDefault(req, res);
      if (!identity) throw new HttpError(401, 'unauthenticated');

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

      if (pathname === '/api/chat' && method === 'POST') {
        if (!config.gateway) throw new HttpError(503, 'chat_disabled');
        if (!deps.chatLimiter.allow(clientIp(req))) throw new HttpError(429, 'rate_limited');
        const parsed = ChatSchema.safeParse(await readJson(req));
        if (!parsed.success) throw new HttpError(400, 'invalid_body');
        const layout = (await deps.layouts.read(identity.id)) ?? EMPTY_LAYOUT;
        const result = await runChat(
          {
            message: parsed.data.message,
            history: parsed.data.history as ChatMessage[],
            catalogue: parsed.data.catalogue,
            layout,
            user: identity
          },
          config.gateway,
          deps.gatewayFetch
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
