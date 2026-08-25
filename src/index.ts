import { serve } from '@hono/node-server';
import { createMcpHonoApp } from '@modelcontextprotocol/hono';
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/server';
import pino from 'pino';
import { AuditLogger } from './audit.js';
import { AuthService } from './auth.js';
import { loadConfig } from './config.js';
import { createServer } from './tools.js';

const config = loadConfig();
const logger = pino({ level: config.logLevel });
const auth = new AuthService(config);
const audit = new AuditLogger(config.auditLogPath);
const app = createMcpHonoApp({ host: config.host, allowedHosts: [new URL(config.publicBaseUrl).hostname] });

app.get('/health', context => context.json({ status: 'ok', service: 'sakura-ecosystem-mcp', version: '0.1.0' }));
app.get('/.well-known/oauth-protected-resource/mcp', context => {
  if (!config.authentik) return context.json({ error: 'Authentik OAuth is not configured.' }, 404);
  return context.json({ resource: `${config.publicBaseUrl}/mcp`, authorization_servers: [config.authentik.issuer] });
});
app.all('/mcp', async context => {
  let principal;
  try { principal = await auth.authenticate(context.req.header('authorization')); }
  catch (error) {
    const message = error instanceof Error ? error.message : 'Unauthorized.';
    return context.json({ error: 'unauthorized', error_description: message }, 401, { 'WWW-Authenticate': `Bearer resource_metadata="${config.publicBaseUrl}/.well-known/oauth-protected-resource/mcp"` });
  }
  const server = createServer(config, principal, audit);
  // Stateless transport prevents one authenticated client's session from being reused by another principal.
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined });
  await server.connect(transport);
  try { return await transport.handleRequest(context.req.raw, { parsedBody: context.get('parsedBody' as never) as unknown }); }
  catch (error) { logger.error({ err: error, principal: principal.id }, 'MCP transport request failed'); return context.json({ error: 'MCP request failed.' }, 500); }
  finally { await transport.close(); }
});

serve({ fetch: app.fetch, hostname: config.host, port: config.port }, info => logger.info({ host: config.host, port: info.port }, 'Sakura MCP Server listening'));
