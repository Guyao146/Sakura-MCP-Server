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
  HOME_ASSISTANT_URL: optionalUrl,
  HOME_ASSISTANT_TOKEN: z.string().optional().or(z.literal('')),
  HOME_ASSISTANT_CONTROLLABLE_ENTITIES: z.string().default(''),
  HOME_ASSISTANT_ALLOWED_SCENES: z.string().default(''),
  LIFE_DASHBOARD_INTERNAL_URL: optionalUrl,
  LIFE_DASHBOARD_INTERNAL_TOKEN: z.string().optional().or(z.literal('')),
  AUDIT_LOG_PATH: z.string().default('./data/audit.jsonl')
});

export type Scope =
  | 'life:read' | 'home:read' | 'home:control' | 'todo:read' | 'todo:write'
  | 'dsh:summary' | 'dsh:details' | 'dsh:followup';

export interface ApiKeyRecord { id: string; secret: string; scopes: Scope[]; }
export interface AppConfig {
  publicBaseUrl: string; host: string; port: number; logLevel: string; apiKeys: ApiKeyRecord[];
  authentik?: { issuer: string; audience: string; jwksUri: string; scopeClaim: string };
  homeAssistant?: { url: string; token: string; controllableEntities: Set<string>; allowedScenes: Set<string> };
  lifeDashboard?: { internalUrl: string; internalToken: string };
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
  const haValues = [value.HOME_ASSISTANT_URL, value.HOME_ASSISTANT_TOKEN];
  if (haValues.some(Boolean) && !haValues.every(Boolean)) throw new Error('HOME_ASSISTANT_URL and HOME_ASSISTANT_TOKEN must be configured together.');
  const dashboardValues = [value.LIFE_DASHBOARD_INTERNAL_URL, value.LIFE_DASHBOARD_INTERNAL_TOKEN];
  if (dashboardValues.some(Boolean) && !dashboardValues.every(Boolean)) throw new Error('LIFE_DASHBOARD_INTERNAL_URL and LIFE_DASHBOARD_INTERNAL_TOKEN must be configured together.');
  if (!value.MCP_API_KEYS && !oauthValues.every(Boolean)) throw new Error('Configure at least one MCP_API_KEYS entry or complete Authentik JWT validation.');
  return {
    publicBaseUrl: value.PUBLIC_BASE_URL.replace(/\/$/, ''), host: value.HOST, port: value.PORT, logLevel: value.LOG_LEVEL,
    apiKeys: parseApiKeys(value.MCP_API_KEYS),
    authentik: oauthValues.every(Boolean) ? { issuer: value.AUTHENTIK_ISSUER!, audience: value.AUTHENTIK_AUDIENCE!, jwksUri: value.AUTHENTIK_JWKS_URI!, scopeClaim: value.AUTHENTIK_SCOPE_CLAIM } : undefined,
    homeAssistant: haValues.every(Boolean) ? { url: value.HOME_ASSISTANT_URL!.replace(/\/$/, ''), token: value.HOME_ASSISTANT_TOKEN!, controllableEntities: new Set(split(value.HOME_ASSISTANT_CONTROLLABLE_ENTITIES)), allowedScenes: new Set(split(value.HOME_ASSISTANT_ALLOWED_SCENES)) } : undefined,
    lifeDashboard: dashboardValues.every(Boolean) ? { internalUrl: value.LIFE_DASHBOARD_INTERNAL_URL!.replace(/\/$/, ''), internalToken: value.LIFE_DASHBOARD_INTERNAL_TOKEN! } : undefined,
    auditLogPath: value.AUDIT_LOG_PATH
  };
}