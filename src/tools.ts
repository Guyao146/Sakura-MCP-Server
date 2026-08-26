import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { Principal } from './auth.js';
import { requireScopes } from './auth.js';
import { AgentRepository } from './agents/repository.js';
import type { AuditLogger } from './audit.js';
import type { AppConfig, Scope } from './config.js';
import type { Database } from './database.js';
import { MemoryRepository } from './memory/repository.js';
import { requireAgentSpaceScope } from './memory/permissions.js';
import { SpaceRepository } from './spaces/repository.js';
import { SemanticMemoryService } from './semantic/service.js';

const memoryType = z.enum(['fact', 'preference', 'event', 'task', 'person', 'project', 'summary', 'document', 'idea', 'other']);
const text = (value: unknown) => ({
  content: [{ type: 'text' as const, text: JSON.stringify(value, null, 2) }],
  structuredContent: value as Record<string, unknown>
});
const failure = (message: string) => ({ content: [{ type: 'text' as const, text: message }], isError: true });

export function createServer(database: Database, principal: Principal, audit: AuditLogger, getConfig: () => AppConfig): McpServer {
  const server = new McpServer({ name: 'Sakura-MCP-Server', version: '0.2.0' });
  const repository = new MemoryRepository(database);
  const semantic = new SemanticMemoryService(database, getConfig);
  const agents = new AgentRepository(database);
  const spaces = new SpaceRepository(database);
  const identity = repository.ensureUser(principal.id, { email: principal.email, displayName: principal.displayName });
  const requireHuman = () => {
    if (principal.source !== 'authentik') throw new Error('This operation requires an interactive Authentik user.');
  };
  const guarded = <T>(name: string, scopes: Scope[], handler: (args: T, userId: string, personalSpaceId: string) => Promise<unknown>) => async (args: T) => {
    try {
      requireScopes(principal, scopes);
      const { userId, personalSpaceId } = await identity;
      const result = await handler(args, userId, personalSpaceId);
      await audit.write(principal, name, 'success');
      return text(result);
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unexpected error.';
      await audit.write(principal, name, 'error', { message });
      return failure(message);
    }
  };

  server.registerTool('memory_remember', {
    description: 'Store a durable memory in the caller personal space or an authorized shared space.',
    inputSchema: {
      space_id: z.string().uuid().optional(), type: memoryType.default('other'), content: z.string().min(1).max(1_000_000),
      summary: z.string().max(2000).optional(), tags: z.array(z.string().min(1).max(80)).max(50).optional(),
      importance: z.number().min(0).max(1).optional(), confidence: z.number().min(0).max(1).optional(),
      sensitivity: z.number().int().min(0).max(3).optional(), valid_from: z.iso.datetime().optional(),
      valid_until: z.iso.datetime().optional(), expires_at: z.iso.datetime().optional(),
      source_type: z.string().min(1).max(80).optional(), source_uri: z.string().max(2000).optional(),
      source_excerpt: z.string().max(10000).optional()
    }
  }, guarded('memory_remember', ['memory:write'], async (args, userId, personalSpaceId) => {
    const spaceId = args.space_id ?? personalSpaceId;
    await requireAgentSpaceScope(database, principal.agentId, spaceId, 'memory:write');
    return semantic.remember(userId, {
    spaceId, type: args.type, content: args.content, summary: args.summary, tags: args.tags,
    importance: args.importance, confidence: args.confidence, sensitivity: args.sensitivity, validFrom: args.valid_from,
    validUntil: args.valid_until, expiresAt: args.expires_at,
    source: args.source_type ? { type: args.source_type, uri: args.source_uri, agent: principal.id, excerpt: args.source_excerpt } : undefined
  });
  }));

  server.registerTool('memory_search', {
    description: 'Search memories with full-text search and filters. An omitted space_id searches the personal space.',
    inputSchema: { space_id: z.string().uuid().optional(), query: z.string().max(2000).default(''), limit: z.number().int().min(1).max(100).default(20), types: z.array(memoryType).max(10).optional(), tags: z.array(z.string().max(80)).max(50).optional() }
  }, guarded('memory_search', ['memory:read'], async (args, userId, personalSpaceId) => {
    const spaceId = args.space_id ?? personalSpaceId;
    await requireAgentSpaceScope(database, principal.agentId, spaceId, 'memory:read');
    return semantic.hybridSearch(userId, spaceId, args.query, args.limit, args.types, args.tags);
  }));

  server.registerTool('memory_recall', {
    description: 'Recall the most relevant durable memories for the supplied context.',
    inputSchema: { context: z.string().min(1).max(20000), space_id: z.string().uuid().optional(), limit: z.number().int().min(1).max(50).default(10) }
  }, guarded('memory_recall', ['memory:read'], async (args, userId, personalSpaceId) => {
    const spaceId = args.space_id ?? personalSpaceId;
    await requireAgentSpaceScope(database, principal.agentId, spaceId, 'memory:read');
    return semantic.hybridSearch(userId, spaceId, args.context, args.limit);
  }));

  server.registerTool('memory_get', {
    description: 'Get one memory by opaque ID after checking current user space membership.', inputSchema: { memory_id: z.string().uuid() }
  }, guarded('memory_get', ['memory:read'], async (args, userId) => {
    const spaceId = await repository.spaceForMemory(userId, args.memory_id);
    await requireAgentSpaceScope(database, principal.agentId, spaceId, 'memory:read');
    return repository.get(userId, args.memory_id);
  }));

  server.registerTool('memory_update', {
    description: 'Update a memory and preserve the previous state in version history.',
    inputSchema: { memory_id: z.string().uuid(), content: z.string().min(1).max(1_000_000).optional(), summary: z.string().max(2000).optional(), tags: z.array(z.string().max(80)).max(50).optional(), importance: z.number().min(0).max(1).optional(), confidence: z.number().min(0).max(1).optional(), status: z.enum(['active', 'pending_confirmation', 'superseded', 'archived']).optional(), reason: z.string().min(1).max(500).default('updated through MCP') }
  }, guarded('memory_update', ['memory:update'], async (args, userId) => {
    const spaceId = await repository.spaceForMemory(userId, args.memory_id);
    await requireAgentSpaceScope(database, principal.agentId, spaceId, 'memory:update');
    return semantic.update(userId, args.memory_id, {
      content: args.content, summary: args.summary, tags: args.tags, importance: args.importance, confidence: args.confidence, status: args.status
    }, args.reason);
  }));

  server.registerTool('memory_forget', {
    description: 'Soft-delete a memory. Permanent deletion additionally requires an admin role in the target space.',
    inputSchema: { memory_id: z.string().uuid(), permanent: z.boolean().default(false) }
  }, guarded('memory_forget', ['memory:delete'], async (args, userId) => {
    const spaceId = await repository.spaceForMemory(userId, args.memory_id);
    await requireAgentSpaceScope(database, principal.agentId, spaceId, 'memory:delete');
    await repository.forget(userId, args.memory_id, args.permanent);
    return { forgotten: true, permanent: args.permanent };
  }));

  server.registerTool('memory_extract', {
    description: 'Extract durable candidate memories from text using the Chat Provider configured for the target space. Does not store them.',
    inputSchema: { space_id: z.string().uuid().optional(), text: z.string().min(1).max(200_000) }
  }, guarded('memory_extract', ['memory:write'], async (args, userId, personalSpaceId) => {
    const spaceId = args.space_id ?? personalSpaceId;
    await requireAgentSpaceScope(database, principal.agentId, spaceId, 'memory:write');
    return { candidates: await semantic.extract(userId, spaceId, args.text) };
  }));

  server.registerTool('memory_extract_and_remember', {
    description: 'Extract durable memories from text and store up to 50 validated candidates in an authorized space.',
    inputSchema: { space_id: z.string().uuid().optional(), text: z.string().min(1).max(200_000) }
  }, guarded('memory_extract_and_remember', ['memory:write'], async (args, userId, personalSpaceId) => {
    const spaceId = args.space_id ?? personalSpaceId;
    await requireAgentSpaceScope(database, principal.agentId, spaceId, 'memory:write');
    return { memories: await semantic.extractAndRemember(userId, spaceId, args.text, principal.id) };
  }));

  server.registerTool('space_list', {
    description: 'List personal and shared memory spaces visible to the current user.', inputSchema: {}
  }, guarded('space_list', ['memory:read'], (_args, userId) => spaces.list(userId, principal.agentId)));

  server.registerTool('space_create', {
    description: 'Create a shared memory space. The current user becomes its owner.',
    inputSchema: { name: z.string().min(1).max(120), description: z.string().max(2000).default('') }
  }, guarded('space_create', ['space:create'], async (args, userId) => { requireHuman(); return spaces.create(userId, args.name, args.description); }));

  server.registerTool('space_list_members', {
    description: 'List members and roles in a visible memory space.', inputSchema: { space_id: z.string().uuid() }
  }, guarded('space_list_members', ['memory:read'], async (args, userId) => {
    await requireAgentSpaceScope(database, principal.agentId, args.space_id, 'memory:read');
    return spaces.members(userId, args.space_id);
  }));

  server.registerTool('space_invite_member', {
    description: 'Invite an Authentik user email to a shared space. The one-time token must be delivered privately.',
    inputSchema: {
      space_id: z.string().uuid(), email: z.email(),
      role: z.enum(['admin', 'editor', 'contributor', 'viewer']).default('contributor'),
      expires_in_hours: z.number().int().min(1).max(168).default(48)
    }
  }, guarded('space_invite_member', ['member:manage'], async (args, userId) => { requireHuman(); return spaces.invite(userId, args.space_id, args.email, args.role, args.expires_in_hours); }));

  server.registerTool('space_accept_invitation', {
    description: 'Accept a shared-space invitation for the current Authentik email. Tokens are single-use and expire.',
    inputSchema: { token: z.string().min(32).max(200) }
  }, guarded('space_accept_invitation', ['memory:read'], async (args, userId) => { requireHuman(); return spaces.accept(userId, principal.email, args.token); }));

  const agentScopes = z.array(z.enum([
    'memory:read', 'memory:write', 'memory:update', 'memory:delete', 'memory:export',
    'space:create', 'space:manage', 'member:manage', 'agent:manage'
  ])).min(1).max(9);

  server.registerTool('agent_create', {
    description: 'Create an Agent API key. The plaintext token is returned exactly once.',
    inputSchema: { name: z.string().min(1).max(120), scopes: agentScopes, expires_at: z.iso.datetime().optional() }
  }, guarded('agent_create', ['agent:manage'], async (args, userId) => {
    requireHuman();
    return agents.create(userId, args.name, args.scopes, args.expires_at);
  }));

  server.registerTool('agent_list', {
    description: 'List the current user Agent credentials and space grants without secret values.', inputSchema: {}
  }, guarded('agent_list', ['agent:manage'], async (_args, userId) => { requireHuman(); return agents.list(userId); }));

  server.registerTool('agent_revoke', {
    description: 'Permanently revoke an Agent API key.', inputSchema: { agent_id: z.string().uuid() }
  }, guarded('agent_revoke', ['agent:manage'], async (args, userId) => { requireHuman(); await agents.revoke(userId, args.agent_id); return { revoked: true }; }));

  server.registerTool('agent_grant_space', {
    description: 'Grant an owned Agent selected scopes in a memory space visible to the current user.',
    inputSchema: { agent_id: z.string().uuid(), space_id: z.string().uuid(), scopes: agentScopes }
  }, guarded('agent_grant_space', ['agent:manage'], async (args, userId) => { requireHuman(); return agents.grant(userId, args.agent_id, args.space_id, args.scopes); }));

  server.registerTool('agent_revoke_space', {
    description: 'Remove all access an owned Agent has to a memory space.',
    inputSchema: { agent_id: z.string().uuid(), space_id: z.string().uuid() }
  }, guarded('agent_revoke_space', ['agent:manage'], async (args, userId) => { requireHuman(); await agents.revokeGrant(userId, args.agent_id, args.space_id); return { revoked: true }; }));
  return server;
}