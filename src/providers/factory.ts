import type { AppConfig } from '../config.js';
import { OllamaProvider } from './ollama.js';
import { OpenAICompatibleProvider } from './openai-compatible.js';
import type { AiProvider } from './types.js';

export type ProviderKind = 'openai_compatible' | 'ollama';

export interface ResolvedProvider {
  kind: ProviderKind;
  provider: AiProvider;
  chatModel?: string;
  embeddingModel?: string;
}

export function createProvider(config: AppConfig, kind: ProviderKind, overrides: { chatModel?: string; embeddingModel?: string } = {}): ResolvedProvider {
  if (kind === 'openai_compatible') {
    const value = config.openaiCompatible;
    if (!value) throw new Error('OpenAI-compatible Provider is not configured.');
    const chatModel = overrides.chatModel ?? value.chatModel;
    const embeddingModel = overrides.embeddingModel ?? value.embeddingModel;
    return { kind, chatModel, embeddingModel,
      provider: new OpenAICompatibleProvider(value.baseUrl, value.apiKey, chatModel, embeddingModel) };
  }
  const value = config.ollama;
  if (!value) throw new Error('Ollama Provider is not configured.');
  const chatModel = overrides.chatModel ?? value.chatModel;
  const embeddingModel = overrides.embeddingModel ?? value.embeddingModel;
  return { kind, chatModel, embeddingModel,
    provider: new OllamaProvider(value.baseUrl, chatModel, embeddingModel) };
}