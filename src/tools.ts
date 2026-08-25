import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Principal } from './auth.js';
import { requireScopes } from './auth.js';
import type { AuditLogger } from './audit.js';
import type { AppConfig, Scope } from './config.js';
import { HomeAssistantAdapter } from './adapters/home-assistant.js';
import { LifeDashboardAdapter } from './adapters/life-dashboard.js';

const text = (value: unknown) => ({ content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }] });
const failure = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function createServer(config: AppConfig, principal: Principal, audit: AuditLogger): McpServer {
  const server = new McpServer({ name: 'sakura-ecosystem-mcp', version: '0.1.0' });
  const home = config.homeAssistant ? new HomeAssistantAdapter(config.homeAssistant) : undefined;
  const dashboard = config.lifeDashboard ? new LifeDashboardAdapter(config.lifeDashboard) : undefined;
  const guarded = <T>(name: string, scopes: Scope[], handler: (args: T) => Promise<unknown>) => async (args: T) => {
    try { requireScopes(principal, scopes); const result = await handler(args); await audit.write(principal, name, 'success'); return text(result); }
    catch (error) { const message = error instanceof Error ? error.message : 'Unexpected error.'; await audit.write(principal, name, 'error', { message }); return failure(message); }
  };
  if (home) {
    server.registerTool('home_list_entities', { description: 'List Home Assistant entities. Returns state metadata only.', inputSchema: { query: z.string().max(120).optional() } }, guarded('home_list_entities', ['home:read'], async ({ query }) => (await home.states()).filter(item => !query || item.entity_id.includes(query) || String(item.attributes.friendly_name ?? '').includes(query)).slice(0, 200)));
    server.registerTool('home_get_entity_state', { description: 'Get the current state of a Home Assistant entity.', inputSchema: { entity_id: z.string().regex(/^[a-z_]+\.[a-zA-Z0-9_]+$/) } }, guarded('home_get_entity_state', ['home:read'], ({ entity_id }) => home.state(entity_id)));
    server.registerTool('home_control_entity', { description: 'Control an explicitly whitelisted Home Assistant entity.', inputSchema: { entity_id: z.string().regex(/^[a-z_]+\.[a-zA-Z0-9_]+$/), action: z.enum(['turn_on', 'turn_off', 'toggle']) } }, guarded('home_control_entity', ['home:control'], ({ entity_id, action }) => home.control(entity_id, action)));
    server.registerTool('home_activate_scene', { description: 'Activate an explicitly whitelisted Home Assistant scene.', inputSchema: { entity_id: z.string().regex(/^scene\.[a-zA-Z0-9_]+$/) } }, guarded('home_activate_scene', ['home:control'], ({ entity_id }) => home.activateScene(entity_id)));
  }
  if (dashboard) {
    server.registerTool('life_get_overview', { description: 'Read the safe summary from the Life Dashboard internal API.', inputSchema: {} }, guarded('life_get_overview', ['life:read'], () => dashboard.overview()));
    server.registerTool('dsh_list_workspaces', { description: 'Read paired DSH workspace summaries. Full session content is never returned.', inputSchema: {} }, guarded('dsh_list_workspaces', ['dsh:summary'], () => dashboard.workspaces()));
    server.registerTool('dsh_send_followup', { description: 'Queue a follow-up message for an authorized online DSH session.', inputSchema: { workspace_id: z.string().min(1).max(128), session_id: z.string().min(1).max(256), message: z.string().min(1).max(8000) } }, guarded('dsh_send_followup', ['dsh:followup'], ({ workspace_id, session_id, message }) => dashboard.sendFollowup(workspace_id, session_id, message)));
  }
  return server;
}
