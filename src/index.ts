import { serve } from '@hono/node-server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import type { Context, Next } from 'hono';
import pino from 'pino';
import { AuditLogger } from './audit.js';
import { AuthService } from './auth.js';
import { loadConfig } from './config.js';
import { Database } from './database.js';
import { createServer } from './tools.js';
import { setupPage } from './setup/page.js';
import { SetupService, setupInputSchema } from './setup/service.js';
import { SettingsRepository } from './settings/repository.js';

const baseConfig = loadConfig();
const logger = pino({ level: baseConfig.logLevel });
const audit = new AuditLogger(baseConfig.auditLogPath);
const database = new Database(baseConfig.database.connectionString, baseConfig.database.maxConnections);
if (baseConfig.database.autoMigrate) await database.migrate();
const settings = new SettingsRepository(database, baseConfig.setup.encryptionKey);
let config = await settings.apply(baseConfig);
let auth = new AuthService(config);
const setup = new SetupService(baseConfig, database, settings);
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
    auth = new AuthService(config);
    return context.json({ completed: true });
  } catch (error) { return context.json({ error: 'setup_failed', error_description: error instanceof Error ? error.message : 'Setup failed.' }, 400); }
});

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
  const server = createServer(database, principal, audit);
  // Stateless transport prevents one authenticated client's session from being reused by another principal.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  try { return await transport.handleRequest(context.req.raw, { parsedBody: context.get('parsedBody' as never) as unknown }); }
  catch (error) { logger.error({ err: error, principal: principal.id }, 'MCP transport request failed'); return context.json({ error: 'MCP request failed.' }, 500); }
  finally { await transport.close(); }
});

serve({ fetch: app.fetch, hostname: baseConfig.host, port: baseConfig.port }, info => logger.info({ host: baseConfig.host, port: info.port }, 'Sakura MCP Server listening'));
