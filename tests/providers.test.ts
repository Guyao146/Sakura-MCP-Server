import { afterEach, describe, expect, it, vi } from 'vitest';
import { OllamaProvider } from '../src/providers/ollama.js';
import { OpenAICompatibleProvider } from '../src/providers/openai-compatible.js';

afterEach(() => vi.unstubAllGlobals());

describe('AI providers', () => {
  it('maps OpenAI-compatible embedding responses by index', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      data: [{ index: 1, embedding: [0, 1] }, { index: 0, embedding: [1, 0] }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAICompatibleProvider('https://api.example.com/v1', 'secret', undefined, 'embed-model');
    await expect(provider.embed(['first', 'second'])).resolves.toEqual([[1, 0], [0, 1]]);
    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/v1/embeddings', expect.objectContaining({ method: 'POST' }));
  });

  it('uses the Ollama batch embed endpoint', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ embeddings: [[0.1, 0.2]] }), {
      status: 200, headers: { 'Content-Type': 'application/json' }
    }));
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OllamaProvider('http://localhost:11434', undefined, 'nomic-embed-text');
    await expect(provider.embed(['memory'])).resolves.toEqual([[0.1, 0.2]]);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:11434/api/embed', expect.objectContaining({ method: 'POST' }));
  });

  it('rejects malformed extracted memories instead of storing model inventions', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      choices: [{ message: { content: '{"memories":[{"type":"invalid","content":"x"}]}' } }]
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));
    const provider = new OpenAICompatibleProvider('https://api.example.com/v1', undefined, 'chat-model');
    await expect(provider.extractMemories('input')).rejects.toThrow();
  });

  it('includes the upstream error body when an embedding request fails', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      error: { message: 'model not allowed for this key' }
    }), { status: 403, headers: { 'Content-Type': 'application/json' } })));
    const provider = new OpenAICompatibleProvider('https://api.example.com/v1', 'secret', undefined, 'embed-model');
    await expect(provider.embed(['x'])).rejects.toThrow('model not allowed for this key');
  });
});