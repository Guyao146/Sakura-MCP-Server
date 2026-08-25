import { z } from 'zod';
import type { AiProvider, ExtractedMemory } from './types.js';

const extractedSchema = z.object({ memories: z.array(z.object({
  type: z.enum(['fact','preference','event','task','person','project','summary','document','idea','other']),
  content: z.string().min(1), summary: z.string(), tags: z.array(z.string()),
  importance: z.number().min(0).max(1), confidence: z.number().min(0).max(1)
})) });

export class OpenAICompatibleProvider implements AiProvider {
  constructor(private readonly baseUrl: string, private readonly apiKey?: string, private readonly chatModel?: string, private readonly embeddingModel?: string) {}
  private headers() { return { 'Content-Type': 'application/json', ...(this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}) }; }
  async embed(texts: string[], model = this.embeddingModel): Promise<number[][]> {
    if (!model) throw new Error('OpenAI-compatible embedding model is not configured.');
    const response = await fetch(`${this.baseUrl}/embeddings`, { method: 'POST', headers: this.headers(), body: JSON.stringify({ model, input: texts }), signal: AbortSignal.timeout(60_000) });
    if (!response.ok) throw new Error(`Embedding request failed (${response.status}).`);
    const body = await response.json() as { data: Array<{ index: number; embedding: number[] }> };
    return body.data.sort((a,b) => a.index-b.index).map(item => item.embedding);
  }
  async extractMemories(text: string, model = this.chatModel): Promise<ExtractedMemory[]> {
    if (!model) throw new Error('OpenAI-compatible chat model is not configured.');
    const response = await fetch(`${this.baseUrl}/chat/completions`, { method: 'POST', headers: this.headers(), body: JSON.stringify({
      model, temperature: 0, response_format: { type: 'json_object' }, messages: [
        { role: 'system', content: 'Extract only durable, useful long-term memories. Return JSON: {"memories":[{"type":"fact|preference|event|task|person|project|summary|document|idea|other","content":"...","summary":"...","tags":[],"importance":0.5,"confidence":0.8}]}. Do not invent facts.' },
        { role: 'user', content: text }
      ] }), signal: AbortSignal.timeout(120_000) });
    if (!response.ok) throw new Error(`Memory extraction request failed (${response.status}).`);
    const body = await response.json() as { choices: Array<{ message: { content: string } }> };
    return extractedSchema.parse(JSON.parse(body.choices[0]?.message.content ?? '{}')).memories;
  }
}
