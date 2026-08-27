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

export class SetupService {
  constructor(private readonly authEnabled: boolean, private readonly database: Database, private readonly settings: SettingsRepository) {}

  async diagnostics() {
    const version = await this.database.query<{ version: string }>('SELECT version()');
    const vector = await this.database.query<{ extversion: string }>("SELECT extversion FROM pg_extension WHERE extname='vector'");
    const migrations = await this.database.query<{ name: string; applied_at: string }>('SELECT name,applied_at FROM schema_migrations ORDER BY name');
    return { database: 'ok', authEnabled: this.authEnabled, postgresVersion: version.rows[0].version,
      pgvectorVersion: vector.rows[0]?.extversion ?? null, migrations: migrations.rows };
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