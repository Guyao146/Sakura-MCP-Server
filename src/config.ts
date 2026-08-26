import 'dotenv/config';
import { z } from 'zod';

const optionalUrl = z.string().url().optional().or(z.literal(''));

const environmentSchema = z.object({
  PUBLIC_BASE_URL: z.string().url(),
  HOST: z.string().default('127.0.0.1'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),
  MCP_API_KEYS: z.string().default(''),
  AUTHENTIK_ISSUER: optionalUrl,
  AUTHENTIK_AUDIENCE: z.string().optional().or(z.literal('')),
  AUTHENTIK_JWKS_URI: optionalUrl,
  AUTHENTIK_SCOPE_CLAIM: z.string().default('scope'),
  DATABASE_URL: z.string().min(1),
  DATABASE_MAX_CONNECTIONS: z.coerce.number().int().min(1).max(100).default(20),
  AUTO_MIGRATE: z.enum(['true', 'false']).default('true'),
  SETUP_TOKEN: z.string().min(32),
  CONFIG_ENCRYPTION_KEY: z.string().min(43),
  OPENAI_COMPATIBLE_BASE_URL: optionalUrl,
  OPENAI_COMPATIBLE_API_KEY: z.string().optional().or(z.literal('')),
  OPENAI_COMPATIBLE_CHAT_MODEL: z.string().optional().or(z.literal('')),
  OPENAI_COMPATIBLE_EMBEDDING_MODEL: z.string().optional().or(z.literal('')),
  OLLAMA_BASE_URL: optionalUrl,
  OLLAMA_CHAT_MODEL: z.string().optional().or(z.literal('')),
  OLLAMA_EMBEDDING_MODEL: z.string().optional().or(z.literal('')),
  WORKER_ENABLED: z.enum(['true', 'false']).default('true'),
  WORKER_POLL_INTERVAL_MS: z.coerce.number().int().min(250).max(60000).default(2000),
  WORKER_STALE_AFTER_SECONDS: z.coerce.number().int().min(30).max(86400).default(900),
  AUDIT_LOG_PATH: z.string().default('./data/audit.jsonl')
});

export type Scope =
  | 'memory:read' | 'memory:write' | 'memory:update' | 'memory:delete' | 'memory:export'
  | 'space:create' | 'space:manage' | 'member:manage' | 'agent:manage' | 'admin:system';

export interface ApiKeyRecord { id: string; secret: string; scopes: Scope[]; }
export interface AppConfig {
  publicBaseUrl: string; host: string; port: number; logLevel: string; apiKeys: ApiKeyRecord[];
  authentik?: {
    issuer: string; audience: string; jwksUri: string; scopeClaim: string;
    clientId?: string; authorizationUrl?: string; tokenUrl?: string; userinfoUrl?: string;
  };
  database: { connectionString: string; maxConnections: number; autoMigrate: boolean };
  setup: { token: string; encryptionKey: string };
  openaiCompatible?: { baseUrl: string; apiKey?: string; chatModel?: string; embeddingModel?: string };
  ollama?: { baseUrl: string; chatModel?: string; embeddingModel?: string };
  worker: { enabled: boolean; pollIntervalMs: number; staleAfterSeconds: number };
  auditLogPath: string;
}

const split = (value: string): string[] => value.split(',').map(item => item.trim()).filter(Boolean);

function parseApiKeys(value: string): ApiKeyRecord[] {
  return split(value).map(entry => {
    const first = entry.indexOf(':');
    const second = entry.indexOf(':', first + 1);
    const id = first > 0 ? entry.slice(0, first) : '';
    const secret = second > first ? entry.slice(first + 1, second) : '';
    const scopesValue = second > first ? entry.slice(second + 1) : '';
    if (!id || !secret || !scopesValue) throw new Error('MCP_API_KEYS entries must use id:secret:scope|scope format.');
    return { id, secret, scopes: scopesValue.split('|').filter(Boolean) as Scope[] };
  });
}

export function loadConfig(env = process.env): AppConfig {
  const value = environmentSchema.parse(env);
  const oauthValues = [value.AUTHENTIK_ISSUER, value.AUTHENTIK_AUDIENCE, value.AUTHENTIK_JWKS_URI];
  if (oauthValues.some(Boolean) && !oauthValues.every(Boolean)) {
    throw new Error('AUTHENTIK_ISSUER, AUTHENTIK_AUDIENCE and AUTHENTIK_JWKS_URI must be configured together.');
  }
  return {
    publicBaseUrl: value.PUBLIC_BASE_URL.replace(/\/$/, ''), host: value.HOST, port: value.PORT, logLevel: value.LOG_LEVEL,
    apiKeys: parseApiKeys(value.MCP_API_KEYS),
    authentik: oauthValues.every(Boolean) ? { issuer: value.AUTHENTIK_ISSUER!, audience: value.AUTHENTIK_AUDIENCE!, jwksUri: value.AUTHENTIK_JWKS_URI!, scopeClaim: value.AUTHENTIK_SCOPE_CLAIM } : undefined,
    database: { connectionString: value.DATABASE_URL, maxConnections: value.DATABASE_MAX_CONNECTIONS, autoMigrate: value.AUTO_MIGRATE === 'true' },
    setup: { token: value.SETUP_TOKEN, encryptionKey: value.CONFIG_ENCRYPTION_KEY },
    openaiCompatible: value.OPENAI_COMPATIBLE_BASE_URL ? { baseUrl: value.OPENAI_COMPATIBLE_BASE_URL.replace(/\/$/, ''), apiKey: value.OPENAI_COMPATIBLE_API_KEY || undefined, chatModel: value.OPENAI_COMPATIBLE_CHAT_MODEL || undefined, embeddingModel: value.OPENAI_COMPATIBLE_EMBEDDING_MODEL || undefined } : undefined,
    ollama: value.OLLAMA_BASE_URL ? { baseUrl: value.OLLAMA_BASE_URL.replace(/\/$/, ''), chatModel: value.OLLAMA_CHAT_MODEL || undefined, embeddingModel: value.OLLAMA_EMBEDDING_MODEL || undefined } : undefined,
    worker: { enabled: value.WORKER_ENABLED === 'true', pollIntervalMs: value.WORKER_POLL_INTERVAL_MS, staleAfterSeconds: value.WORKER_STALE_AFTER_SECONDS },
    auditLogPath: value.AUDIT_LOG_PATH
  };
}