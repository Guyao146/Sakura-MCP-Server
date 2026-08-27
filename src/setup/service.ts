import { z } from 'zod';
import type { Database } from '../database.js';
import { OllamaProvider } from '../providers/ollama.js';
import { OpenAICompatibleProvider } from '../providers/openai-compatible.js';
import type { SettingsRepository } from '../settings/repository.js';

export const setupInputSchema = z.object({
  administratorEmail: z.email().optional(),
  authentik: z.object({
    issuer: z.url(), audience: z.string().min(1).max(500), jwksUri: z.url(), scopeClaim: z.string().min(1).max(100).default('scope'),
    clientId: z.string().min(1).max(500), authorizationUrl: z.url(), tokenUrl: z.url(), userinfoUrl: z.url().optional()
  }).optional(),
  openaiCompatible: z.object({ baseUrl: z.url(), apiKey: z.string().max(1000).optional(), chatModel: z.string().max(200).optional(), embeddingModel: z.string().max(200).optional() }).optional(),
  ollama: z.object({ baseUrl: z.url(), chatModel: z.string().max(200).optional(), embeddingModel: z.string().max(200).optional() }).optional()
});
export type SetupInput = z.infer<typeof setupInputSchema>;

export const authentikDiscoveryInputSchema = z.object({
  baseUrl: z.url(),
  applicationSlug: z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9_-]*$/,
    'Authentik application slug may only contain letters, numbers, underscores, and hyphens.')
});

const authentikDiscoverySchema = z.object({
  issuer: z.url(),
  authorization_endpoint: z.url(),
  token_endpoint: z.url(),
  jwks_uri: z.url(),
  userinfo_endpoint: z.url().optional()
});

export class SetupService {
  constructor(private readonly authEnabled: boolean, private readonly database: Database, private readonly settings: SettingsRepository) {}

  async diagnostics() {
    const version = await this.database.query<{ version: string }>('SELECT version()');
    const vector = await this.database.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname='vector'");
    const migrations = await this.database.query<{ name: string; applied_at: string }>('SELECT name,applied_at FROM schema_migrations ORDER BY name');
    return { database: 'ok', authEnabled: this.authEnabled, postgresVersion: version.rows[0].version,
      pgvectorVersion: vector.rows[0]?.extversion ?? null, migrations: migrations.rows };
  }

  async discoverAuthentik(input: z.infer<typeof authentikDiscoveryInputSchema>) {
    if (!this.authEnabled) throw new Error('Authentik discovery is unavailable when AUTH=false.');
    const parsed = authentikDiscoveryInputSchema.parse(input);
    const base = new URL(parsed.baseUrl);
    if (base.protocol !== 'https:' || base.username || base.password || base.pathname !== '/' || base.search || base.hash) {
      throw new Error('Authentik address must be an HTTPS origin without credentials, path, query, or fragment.');
    }
    const discoveryUrl = new URL(`/application/o/${encodeURIComponent(parsed.applicationSlug)}/.well-known/openid-configuration`, base);
    const response = await fetch(discoveryUrl, {
      headers: { Accept: 'application/json' }, redirect: 'error', signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) throw new Error(`Authentik discovery request failed (${response.status}).`);
    const raw = await readBoundedText(response, 1_000_000);
    let decoded: unknown;
    try { decoded = JSON.parse(raw); }
    catch { throw new Error('Authentik discovery response is not valid JSON.'); }
    const metadata = authentikDiscoverySchema.parse(decoded);
    for (const value of [metadata.issuer, metadata.authorization_endpoint, metadata.token_endpoint,
      metadata.jwks_uri, metadata.userinfo_endpoint].filter(Boolean) as string[]) {
      const endpoint = new URL(value);
      if (endpoint.protocol !== 'https:' || endpoint.origin !== base.origin) {
        throw new Error('Authentik discovery returned an insecure or cross-origin endpoint.');
      }
    }
    return {
      discoveryUrl: discoveryUrl.toString(), issuer: metadata.issuer, jwksUri: metadata.jwks_uri,
      authorizationUrl: metadata.authorization_endpoint, tokenUrl: metadata.token_endpoint,
      userinfoUrl: metadata.userinfo_endpoint
    };
  }

  async testAuthentik(authentik: NonNullable<SetupInput['authentik']>) {
    const issuer = authentik.issuer.replace(/\/$/, '');
    const metadataUrl = `${issuer}/.well-known/openid-configuration`;
    const [metadataResponse, jwksResponse] = await Promise.all([
      fetch(metadataUrl, { signal: AbortSignal.timeout(10_000) }),
      fetch(authentik.jwksUri, { signal: AbortSignal.timeout(10_000) })
    ]);
    if (!metadataResponse.ok) throw new Error(`Authentik metadata request failed (${metadataResponse.status}).`);
    if (!jwksResponse.ok) throw new Error(`Authentik JWKS request failed (${jwksResponse.status}).`);
    const metadata = await metadataResponse.json() as { issuer?: string; authorization_endpoint?: string; token_endpoint?: string };
    const jwks = await jwksResponse.json() as { keys?: unknown[] };
    if (!metadata.authorization_endpoint || !metadata.token_endpoint) throw new Error('Authentik metadata is missing OAuth endpoints.');
    if (!Array.isArray(jwks.keys) || jwks.keys.length === 0) throw new Error('Authentik JWKS contains no signing keys.');
    return { issuer: metadata.issuer, authorizationEndpoint: metadata.authorization_endpoint, tokenEndpoint: metadata.token_endpoint, signingKeys: jwks.keys.length };
  }

  async testProvider(input: Pick<SetupInput, 'openaiCompatible' | 'ollama'>) {
    if (input.openaiCompatible) {
      const provider = new OpenAICompatibleProvider(input.openaiCompatible.baseUrl.replace(/\/$/, ''), input.openaiCompatible.apiKey, input.openaiCompatible.chatModel, input.openaiCompatible.embeddingModel);
      if (input.openaiCompatible.embeddingModel) await provider.embed(['Sakura-MCP-Server installation test']);
      return { provider: 'openai_compatible', status: 'ok', embeddingTested: Boolean(input.openaiCompatible.embeddingModel) };
    }
    if (input.ollama) {
      const provider = new OllamaProvider(input.ollama.baseUrl.replace(/\/$/, ''), input.ollama.chatModel, input.ollama.embeddingModel);
      if (input.ollama.embeddingModel) await provider.embed(['Sakura-MCP-Server installation test']);
      return { provider: 'ollama', status: 'ok', embeddingTested: Boolean(input.ollama.embeddingModel) };
    }
    throw new Error('A provider configuration is required.');
  }

  async complete(input: SetupInput) {
    if (this.authEnabled && (!input.administratorEmail || !input.authentik)) {
      throw new Error('Administrator email and Authentik configuration are required when AUTH=true.');
    }
    await this.settings.complete(this.authEnabled ? input : {
      openaiCompatible: input.openaiCompatible, ollama: input.ollama
    });
  }
}

async function readBoundedText(response: Response, limit: number): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > limit) throw new Error('Authentik discovery response is too large.');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let size = 0;
  let output = '';
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('Authentik discovery response is too large.');
      output += decoder.decode(value, { stream: true });
    }
    return output + decoder.decode();
  } finally { await reader.cancel().catch(() => undefined); }
}