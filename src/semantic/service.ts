import { createHash } from 'node:crypto';
import type { AppConfig } from '../config.js';
import type { Database } from '../database.js';
import { requireSpaceRole } from '../memory/permissions.js';
import { MemoryRepository } from '../memory/repository.js';
import type { MemoryRecord, RememberInput } from '../memory/types.js';
import { createProvider, type ProviderKind, type ResolvedProvider } from '../providers/factory.js';
import type { ExtractedMemory } from '../providers/types.js';
import { MemoryGovernanceService } from '../governance/service.js';

interface SpaceStrategy {
  provider_type: ProviderKind | null;
  chat_model: string | null;
  embedding_model: string | null;
  auto_extract_enabled: boolean;
  auto_merge_enabled: boolean;
  conflict_detection_enabled: boolean;
  privacy_mode: boolean;
}

export class SemanticMemoryService {
  readonly repository: MemoryRepository;
  constructor(private readonly database: Database, private readonly getConfig: () => AppConfig) {
    this.repository = new MemoryRepository(database);
  }

  async strategy(userId: string, spaceId: string): Promise<SpaceStrategy> {
    await requireSpaceRole(this.database, userId, spaceId, 'viewer');
    const result = await this.database.query<SpaceStrategy>(
      `SELECT sps.provider_type,sps.chat_model,sps.embedding_model,s.auto_extract_enabled,s.auto_merge_enabled,
       s.conflict_detection_enabled,s.privacy_mode FROM spaces s
       LEFT JOIN space_provider_settings sps ON sps.space_id=s.id WHERE s.id=$1 AND s.deleted_at IS NULL`, [spaceId]);
    if (!result.rows[0]) throw new Error('Memory space not found.');
    return result.rows[0];
  }

  async configureStrategy(userId: string, spaceId: string, input: {
    providerType?: ProviderKind; chatModel?: string; embeddingModel?: string;
    autoExtractEnabled: boolean; autoMergeEnabled: boolean; conflictDetectionEnabled: boolean; privacyMode: boolean;
  }) {
    await requireSpaceRole(this.database, userId, spaceId, 'admin');
    if (input.privacyMode && input.providerType === 'openai_compatible') {
      throw new Error('Privacy mode only permits the local Ollama Provider.');
    }
    if (input.providerType) createProvider(this.getConfig(), input.providerType, { chatModel: input.chatModel, embeddingModel: input.embeddingModel });
    const client = await this.database.pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(
        `UPDATE spaces SET auto_extract_enabled=$2,auto_merge_enabled=$3,conflict_detection_enabled=$4,privacy_mode=$5,updated_at=now()
         WHERE id=$1`, [spaceId, input.autoExtractEnabled, input.autoMergeEnabled, input.conflictDetectionEnabled, input.privacyMode]);
      await client.query(
        `INSERT INTO space_provider_settings(space_id,provider_type,chat_model,embedding_model)
         VALUES($1,$2,$3,$4) ON CONFLICT(space_id) DO UPDATE SET provider_type=EXCLUDED.provider_type,
         chat_model=EXCLUDED.chat_model,embedding_model=EXCLUDED.embedding_model,updated_at=now()`,
        [spaceId, input.providerType ?? null, input.chatModel ?? null, input.embeddingModel ?? null]);
      await client.query('COMMIT');
    } catch (error) { await client.query('ROLLBACK'); throw error; }
    finally { client.release(); }
    return this.strategy(userId, spaceId);
  }

  async remember(userId: string, input: RememberInput): Promise<MemoryRecord & { embeddingStatus: string }> {
    const memory = await this.repository.remember(userId, input);
    const embeddingStatus = await this.embedMemory(userId, memory).catch(() => 'failed');
    return { ...memory, embeddingStatus };
  }

  async update(userId: string, memoryId: string, patch: Parameters<MemoryRepository['update']>[2], reason: string) {
    const memory = await this.repository.update(userId, memoryId, patch, reason);
    const contentChanged = patch.content !== undefined || patch.summary !== undefined || patch.tags !== undefined;
    const embeddingStatus = contentChanged ? await this.embedMemory(userId, memory).catch(() => 'failed') : await this.embeddingStatus(memory.id);
    return { ...memory, embeddingStatus };
  }

  async hybridSearch(userId: string, spaceId: string, query: string, limit: number, types?: string[], tags?: string[]) {
    await requireSpaceRole(this.database, userId, spaceId, 'viewer');
    const resolved = await this.resolve(userId, spaceId, 'embedding');
    if (!resolved || !query.trim()) return this.repository.search(userId, spaceId, query, limit, types, tags);
    let queryEmbedding: number[];
    try { queryEmbedding = (await resolved.provider.embed([query], resolved.embeddingModel))[0]; }
    catch { return this.repository.search(userId, spaceId, query, limit, types, tags); }
    if (!queryEmbedding?.length) return this.repository.search(userId, spaceId, query, limit, types, tags);
    const result = await this.database.query<MemoryRecord & { text_rank: number; embedding_text: string | null; dimensions: number | null }>(
      `SELECT m.*,ts_rank_cd(m.search_vector,websearch_to_tsquery('simple',$2)) AS text_rank,
       CASE WHEN me.status='ready' THEN me.embedding::text ELSE NULL END AS embedding_text,me.dimensions
       FROM memories m LEFT JOIN memory_embeddings me ON me.memory_id=m.id
       WHERE m.space_id=$1 AND m.status IN ('active','pending_confirmation') AND m.deleted_at IS NULL
       AND (m.expires_at IS NULL OR m.expires_at>now())
       AND ($3::text[] IS NULL OR m.type::text=ANY($3)) AND ($4::text[] IS NULL OR m.tags&&$4)
       ORDER BY m.updated_at DESC LIMIT 1000`,
      [spaceId, query, types?.length ? types : null, tags?.length ? tags : null]);
    return result.rows.map(row => {
      const candidate = row.dimensions === queryEmbedding.length && row.embedding_text ? parseVector(row.embedding_text) : undefined;
      const semantic = candidate ? cosineSimilarity(queryEmbedding, candidate) : 0;
      const score = 0.60 * semantic + 0.25 * Math.min(Number(row.text_rank) * 4, 1)
        + 0.10 * Number(row.importance) + 0.05 * Number(row.confidence);
      const { embedding_text: _embedding, dimensions: _dimensions, text_rank: _rank, ...memory } = row;
      return { ...memory, score };
    }).sort((left, right) => right.score - left.score).slice(0, limit);
  }

  async extract(userId: string, spaceId: string, text: string): Promise<ExtractedMemory[]> {
    await requireSpaceRole(this.database, userId, spaceId, 'contributor');
    const resolved = await this.resolve(userId, spaceId, 'chat');
    if (!resolved) throw new Error('This space has no Chat Provider configured.');
    return resolved.provider.extractMemories(text, resolved.chatModel);
  }

  async rebuildEmbedding(userId: string, memoryId: string): Promise<{ memoryId: string; status: string }> {
    const memory = await this.repository.get(userId, memoryId);
    await requireSpaceRole(this.database, userId, memory.space_id, 'editor');
    const status = await this.embedMemory(userId, memory).catch(() => 'failed');
    return { memoryId, status };
  }

  async extractAndRemember(userId: string, spaceId: string, text: string, sourceAgent?: string) {
    const candidates = await this.extract(userId, spaceId, text);
    const strategy = await this.strategy(userId, spaceId);
    const governance = new MemoryGovernanceService(this.database);
    const stored = [];
    for (const candidate of candidates.slice(0, 50)) {
      const memory = await this.remember(userId, { spaceId, ...candidate,
        source: { type: 'automatic_extraction', agent: sourceAgent, excerpt: text.slice(0, 10_000) } });
      const governanceResult = strategy.auto_merge_enabled || strategy.conflict_detection_enabled
        ? await governance.detect(userId, memory.id) : undefined;
      stored.push({ ...memory, governance: governanceResult });
    }
    return stored;
  }

  private async embedMemory(userId: string, memory: MemoryRecord): Promise<string> {
    const resolved = await this.resolve(userId, memory.space_id, 'embedding');
    const content = `${memory.summary}\n${memory.content}\n${memory.tags.join(' ')}`.trim();
    const contentHash = createHash('sha256').update(content).digest('hex');
    if (!resolved?.embeddingModel) {
      await this.storeEmbedding(memory.id, 'unconfigured', contentHash, 'failed', undefined, 'No Embedding Provider configured.');
      return 'failed';
    }
    await this.storeEmbedding(memory.id, resolved.embeddingModel, contentHash, 'pending');
    try {
      const embedding = (await resolved.provider.embed([content], resolved.embeddingModel))[0];
      if (!embedding?.length || embedding.some(value => !Number.isFinite(value))) throw new Error('Provider returned an invalid embedding.');
      await this.storeEmbedding(memory.id, resolved.embeddingModel, contentHash, 'ready', embedding);
      return 'ready';
    } catch (error) {
      await this.storeEmbedding(memory.id, resolved.embeddingModel, contentHash, 'failed', undefined, error instanceof Error ? error.message : 'Embedding failed.');
      throw error;
    }
  }

  private async storeEmbedding(memoryId: string, model: string, contentHash: string, status: 'pending'|'ready'|'failed', embedding?: number[], error?: string) {
    const vector = embedding ? `[${embedding.join(',')}]` : null;
    await this.database.query(
      `INSERT INTO memory_embeddings(memory_id,model,dimensions,embedding,content_hash,status,error)
       VALUES($1,$2,$3,$4::vector,$5,$6,$7) ON CONFLICT(memory_id) DO UPDATE SET model=EXCLUDED.model,
       dimensions=EXCLUDED.dimensions,embedding=EXCLUDED.embedding,content_hash=EXCLUDED.content_hash,status=EXCLUDED.status,error=EXCLUDED.error,updated_at=now()`,
      [memoryId, model, embedding?.length ?? null, vector, contentHash, status, error ?? null]);
  }

  private async embeddingStatus(memoryId: string): Promise<string> {
    const result = await this.database.query<{ status: string }>('SELECT status FROM memory_embeddings WHERE memory_id=$1', [memoryId]);
    return result.rows[0]?.status ?? 'missing';
  }

  private async resolve(userId: string, spaceId: string, capability: 'chat'|'embedding'): Promise<ResolvedProvider | undefined> {
    const strategy = await this.strategy(userId, spaceId);
    let kind = strategy.provider_type;
    if (!kind) {
      if (strategy.privacy_mode) kind = this.getConfig().ollama ? 'ollama' : null;
      else kind = this.getConfig().openaiCompatible ? 'openai_compatible' : this.getConfig().ollama ? 'ollama' : null;
    }
    if (!kind) return undefined;
    const resolved = createProvider(this.getConfig(), kind, { chatModel: strategy.chat_model ?? undefined, embeddingModel: strategy.embedding_model ?? undefined });
    if (capability === 'chat' && !resolved.chatModel) return undefined;
    if (capability === 'embedding' && !resolved.embeddingModel) return undefined;
    return resolved;
  }
}

function parseVector(value: string): number[] {
  return value.slice(1, -1).split(',').map(Number);
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0; let leftNorm = 0; let rightNorm = 0;
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index] * right[index]; leftNorm += left[index] ** 2; rightNorm += right[index] ** 2;
  }
  if (!leftNorm || !rightNorm) return 0;
  return dot / (Math.sqrt(leftNorm) * Math.sqrt(rightNorm));
}