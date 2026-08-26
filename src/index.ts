import { serve } from '@hono/node-server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import type { Context, Next } from 'hono';
import pino from 'pino';
import * as z from 'zod/v4';
import { AuditLogger } from './audit.js';
import { AgentRepository } from './agents/repository.js';
import { AuthService } from './auth.js';
import { loadConfig } from './config.js';
import { Database } from './database.js';
import { MemoryRepository } from './memory/repository.js';
import { SpaceRepository } from './spaces/repository.js';
import { SemanticMemoryService } from './semantic/service.js';
import { createServer } from './tools.js';
import { setupPage } from './setup/page.js';
import { SetupService, setupInputSchema } from './setup/service.js';
import { SettingsRepository } from './settings/repository.js';
import { WebSessionService } from './web/session.js';
import type { WebIdentity } from './web/session.js';
import { adminPage } from './web/admin-page.js';

const baseConfig = loadConfig();
const logger = pino({ level: baseConfig.logLevel });
const audit = new AuditLogger(baseConfig.auditLogPath);
const database = new Database(baseConfig.database.connectionString, baseConfig.database.maxConnections);
if (baseConfig.database.autoMigrate) await database.migrate();
const settings = new SettingsRepository(database, baseConfig.setup.encryptionKey);
let config = await settings.apply(baseConfig);
let auth = new AuthService(config, database);
const setup = new SetupService(baseConfig, database, settings);
const webSessions = new WebSessionService(database, () => config);
const memories = new MemoryRepository(database);
const spaces = new SpaceRepository(database);
const agents = new AgentRepository(database);
const semantic = new SemanticMemoryService(database, () => config);
const app = createMcpHonoApp({ host: baseConfig.host, allowedHosts: [new URL(baseConfig.publicBaseUrl).hostname] });

const setupGuard = async (context: Context, next: Next) => {
  const installation = await settings.installation();
  if (installation.completed) return context.json({ error: 'setup_locked', error_description: 'Sakura-MCP-Server is already installed.' }, 410);
  if (!setup.verifyToken(context.req.header('x-setup-token'))) return context.json({ error: 'unauthorized', error_description: 'Invalid setup token.' }, 401);
  await next();
};

app.get('/setup', context => context.html(setupPage));
app.get('/api/setup/status', async context => context.json(await settings.installation()));
app.use('/api/setup/*', setupGuard);
app.get('/api/setup/diagnostics', async context => context.json(await setup.diagnostics()));
app.post('/api/setup/test-authentik', async context => {
  try {
    const body = setupInputSchema.pick({ authentik: true }).parse(await context.req.json());
    return context.json(await setup.testAuthentik(body.authentik));
  } catch (error) { return context.json({ error: 'validation_failed', error_description: error instanceof Error ? error.message : 'Validation failed.' }, 400); }
});
app.post('/api/setup/test-provider', async context => {
  try {
    const body = setupInputSchema.pick({ openaiCompatible: true, ollama: true }).parse(await context.req.json());
    return context.json(await setup.testProvider(body));
  } catch (error) { return context.json({ error: 'provider_test_failed', error_description: error instanceof Error ? error.message : 'Provider test failed.' }, 400); }
});
app.post('/api/setup/complete', async context => {
  try {
    const body = setupInputSchema.parse(await context.req.json());
    await setup.complete(body);
    config = await settings.apply(baseConfig);
    auth = new AuthService(config, database);
    return context.json({ completed: true });
  } catch (error) { return context.json({ error: 'setup_failed', error_description: error instanceof Error ? error.message : 'Setup failed.' }, 400); }
});

app.get('/auth/login', async context => {
  if (!(await settings.installation()).completed) return context.redirect('/setup');
  try { return context.redirect(await webSessions.begin(context.req.query('return_to') ?? '/admin')); }
  catch (error) { return context.json({ error: 'login_failed', error_description: error instanceof Error ? error.message : 'Login failed.' }, 500); }
});
app.get('/auth/callback', async context => {
  const code = context.req.query('code'); const state = context.req.query('state');
  if (!code || !state) return context.json({ error: 'invalid_callback', error_description: 'Missing code or state.' }, 400);
  try {
    const result = await webSessions.callback(code, state);
    context.header('Set-Cookie', webSessions.cookie(result.token));
    return context.redirect(result.returnTo);
  } catch (error) { return context.json({ error: 'callback_failed', error_description: error instanceof Error ? error.message : 'OIDC callback failed.' }, 401); }
});
app.post('/auth/logout', async context => {
  try {
    const token = WebSessionService.readCookie(context.req.header('cookie'));
    const identity = await webSessions.authenticate(token);
    if (!webSessions.verifyCsrf(identity, context.req.header('x-csrf-token'))) {
      return context.json({ error: 'csrf_failed', error_description: 'CSRF token is missing or invalid.' }, 403);
    }
    await webSessions.logout(token);
    context.header('Set-Cookie', webSessions.clearCookie());
    return context.json({ loggedOut: true });
  } catch (error) {
    return context.json({ error: 'unauthorized', error_description: error instanceof Error ? error.message : 'Unauthorized.' }, 401);
  }
});
app.get('/api/me', async context => {
  try {
    const identity = await webSessions.authenticate(WebSessionService.readCookie(context.req.header('cookie')));
    return context.json({ id: identity.userId, email: identity.email, displayName: identity.displayName,
      avatarUrl: identity.avatarUrl, isSystemAdmin: identity.isSystemAdmin, expiresAt: identity.expiresAt });
  } catch (error) { return context.json({ error: 'unauthorized', error_description: error instanceof Error ? error.message : 'Unauthorized.' }, 401); }
});
app.get('/admin', async context => {
  try {
    await adminIdentity(context);
    return context.html(adminPage);
  } catch { return context.redirect('/auth/login?return_to=/admin'); }
});

const memoryTypeSchema = z.enum(['fact', 'preference', 'event', 'task', 'person', 'project', 'summary', 'document', 'idea', 'other']);
const memoryWriteSchema = z.object({
  space_id: z.string().uuid(), type: memoryTypeSchema.default('other'), content: z.string().min(1).max(1_000_000),
  summary: z.string().max(2000).default(''), tags: z.array(z.string().min(1).max(80)).max(50).default([])
});
const agentScopeSchema = z.array(z.enum([
  'memory:read', 'memory:write', 'memory:update', 'memory:delete', 'memory:export',
  'space:create', 'space:manage', 'member:manage', 'agent:manage'
])).min(1).max(9);

app.get('/api/admin/bootstrap', async context => adminApi(context, false, async identity => ({
  csrf: webSessions.csrf(identity),
  me: { id: identity.userId, email: identity.email, displayName: identity.displayName, isSystemAdmin: identity.isSystemAdmin },
  spaces: await spaces.list(identity.userId), agents: await agents.list(identity.userId)
})));
app.get('/api/admin/spaces', async context => adminApi(context, false, identity => spaces.list(identity.userId)));
app.post('/api/admin/spaces', async context => adminApi(context, true, async identity => {
  const body = z.object({ name: z.string().min(1).max(120), description: z.string().max(2000).default('') }).parse(await context.req.json());
  return spaces.create(identity.userId, body.name, body.description);
}));
app.get('/api/admin/spaces/:id/members', async context => adminApi(context, false, identity =>
  spaces.members(identity.userId, z.string().uuid().parse(context.req.param('id')))));
app.post('/api/admin/spaces/:id/invitations', async context => adminApi(context, true, async identity => {
  const body = z.object({ email: z.email(), role: z.enum(['admin', 'editor', 'contributor', 'viewer']).default('contributor'), expires_in_hours: z.number().int().min(1).max(168).default(48) }).parse(await context.req.json());
  return spaces.invite(identity.userId, z.string().uuid().parse(context.req.param('id')), body.email, body.role, body.expires_in_hours);
}));
app.get('/api/admin/spaces/:id/strategy', async context => adminApi(context, false, identity =>
  semantic.strategy(identity.userId, z.string().uuid().parse(context.req.param('id')))));
app.put('/api/admin/spaces/:id/strategy', async context => adminApi(context, true, async identity => {
  const body = z.object({
    providerType: z.enum(['openai_compatible', 'ollama']).optional(), chatModel: z.string().max(200).optional(),
    embeddingModel: z.string().max(200).optional(), autoExtractEnabled: z.boolean().default(false),
    autoMergeEnabled: z.boolean().default(false), conflictDetectionEnabled: z.boolean().default(true), privacyMode: z.boolean().default(false)
  }).parse(await context.req.json());
  return semantic.configureStrategy(identity.userId, z.string().uuid().parse(context.req.param('id')), body);
}));
app.get('/api/admin/memories', async context => adminApi(context, false, async identity => {
  const query = z.object({ space_id: z.string().uuid(), query: z.string().max(2000).default('') }).parse(context.req.query());
  return { memories: await semantic.hybridSearch(identity.userId, query.space_id, query.query, 100) };
}));
app.post('/api/admin/memories', async context => adminApi(context, true, async identity => {
  const body = memoryWriteSchema.parse(await context.req.json());
  return semantic.remember(identity.userId, { spaceId: body.space_id, type: body.type, content: body.content,
    summary: body.summary, tags: body.tags, source: { type: 'web_admin', agent: identity.subject } });
}));
app.patch('/api/admin/memories/:id', async context => adminApi(context, true, async identity => {
  const id = z.string().uuid().parse(context.req.param('id'));
  const body = memoryWriteSchema.omit({ space_id: true, type: true }).partial().parse(await context.req.json());
  return semantic.update(identity.userId, id, body, 'updated through Web management');
}));
app.delete('/api/admin/memories/:id', async context => adminApi(context, true, async identity => {
  const id = z.string().uuid().parse(context.req.param('id'));
  await memories.forget(identity.userId, id, false);
  return { deleted: true };
}));
app.get('/api/admin/agents', async context => adminApi(context, false, identity => agents.list(identity.userId)));
app.post('/api/admin/agents', async context => adminApi(context, true, async identity => {
  const body = z.object({ name: z.string().min(1).max(120), scopes: agentScopeSchema, expires_at: z.iso.datetime().optional() }).parse(await context.req.json());
  return agents.create(identity.userId, body.name, body.scopes, body.expires_at);
}));
app.post('/api/admin/agents/:id/revoke', async context => adminApi(context, true, async identity => {
  await agents.revoke(identity.userId, z.string().uuid().parse(context.req.param('id')));
  return { revoked: true };
}));
app.post('/api/admin/agents/:id/grants', async context => adminApi(context, true, async identity => {
  const body = z.object({ space_id: z.string().uuid(), scopes: agentScopeSchema }).parse(await context.req.json());
  return agents.grant(identity.userId, z.string().uuid().parse(context.req.param('id')), body.space_id, body.scopes);
}));
app.get('/api/admin/providers', async context => adminApi(context, false, async identity => {
  if (!identity.isSystemAdmin) throw new Error('System administrator permission is required.');
  return {
    openaiCompatible: config.openaiCompatible ? { configured: true, baseUrl: config.openaiCompatible.baseUrl,
      chatModel: config.openaiCompatible.chatModel, embeddingModel: config.openaiCompatible.embeddingModel, hasApiKey: Boolean(config.openaiCompatible.apiKey) } : { configured: false },
    ollama: config.ollama ? { configured: true, baseUrl: config.ollama.baseUrl,
      chatModel: config.ollama.chatModel, embeddingModel: config.ollama.embeddingModel } : { configured: false }
  };
}));
app.put('/api/admin/providers/:kind', async context => adminApi(context, true, async identity => {
  if (!identity.isSystemAdmin) throw new Error('System administrator permission is required.');
  const kind = z.enum(['openai_compatible', 'ollama']).parse(context.req.param('kind'));
  const body = z.object({ baseUrl: z.url(), apiKey: z.string().max(1000).optional(), chatModel: z.string().max(200).optional(), embeddingModel: z.string().max(200).optional() }).parse(await context.req.json());
  if (kind === 'openai_compatible' && !body.apiKey && config.openaiCompatible?.apiKey) body.apiKey = config.openaiCompatible.apiKey;
  await settings.saveProvider(kind, { baseUrl: body.baseUrl.replace(/\/$/, ''), apiKey: kind === 'openai_compatible' ? body.apiKey : undefined,
    chatModel: body.chatModel, embeddingModel: body.embeddingModel });
  config = await settings.apply(baseConfig);
  auth = new AuthService(config, database);
  return { saved: true };
}));

app.get('/health', async context => {
  try {
    await database.query('SELECT 1');
    return context.json({ status: 'ok', service: 'Sakura-MCP-Server', version: '0.2.0', database: 'ok' });
  } catch {
    return context.json({ status: 'degraded', service: 'Sakura-MCP-Server', version: '0.2.0', database: 'unavailable' }, 503);
  }
});
app.get('/.well-known/oauth-protected-resource/mcp', context => {
  if (!config.authentik) return context.json({ error: 'Authentik OAuth is not configured.' }, 404);
  return context.json({ resource: `${config.publicBaseUrl}/mcp`, authorization_servers: [config.authentik.issuer] });
});
app.all('/mcp', async context => {
  if (!(await settings.installation()).completed) return context.json({ error: 'setup_required', error_description: 'Complete installation at /setup first.' }, 503);
  let principal;
  try { principal = await auth.authenticate(context.req.header('authorization')); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized.';
    return context.json({ error: 'unauthorized', error_description: message }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp"` });
  }
  const server = createServer(database, principal, audit, () => config);
  // Stateless transport prevents one authenticated client's session from being reused by another principal.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  try { return await transport.handleRequest(context.req.raw, { parsedBody: context.get('parsedBody' as never) as unknown }); }
  catch (error) { logger.error({ err: error, principal: principal.id }, 'MCP transport request failed'); return context.json({ error: 'MCP request failed.' }, 500); }
  finally { await transport.close(); }
});

serve({ fetch: app.fetch, hostname: baseConfig.host, port: baseConfig.port }, info => logger.info({ host: baseConfig.host, port: info.port }, 'Sakura MCP Server listening'));

async function adminIdentity(context: Context): Promise<WebIdentity> {
  return webSessions.authenticate(WebSessionService.readCookie(context.req.header('cookie')));
}

async function adminApi(context: Context, write: boolean, handler: (identity: WebIdentity) => Promise<unknown>): Promise<Response> {
  try {
    const identity = await adminIdentity(context);
    if (write && !webSessions.verifyCsrf(identity, context.req.header('x-csrf-token'))) {
      return context.json({ error: 'csrf_failed', error_description: 'CSRF token is missing or invalid.' }, 403);
    }
    return context.json(await handler(identity));
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Request failed.';
    const unauthorized = /session is|session is missing/i.test(message);
    return context.json({ error: unauthorized ? 'unauthorized' : 'request_failed', error_description: message }, unauthorized ? 401 : 400);
  }
}
