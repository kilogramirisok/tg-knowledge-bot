import { createOpenAI } from '@ai-sdk/openai';
import type { Config } from '../config.js';

/**
 * Generate an embedding for a text using OpenRouter (OpenAI-compatible API).
 * Falls back to deterministic hash-based embeddings if API fails.
 */
export async function generateEmbedding(
  text: string,
  config: Config,
): Promise<number[]> {
  try {
    const openrouter = createOpenAI({
      baseURL: config.LLM_BASE_URL,
      apiKey: config.LLM_API_KEY,
    });

    const model = openrouter.embedding(config.EMBEDDING_MODEL);
    const result = await model.doEmbed({
      values: [text],
    });

    return result.embeddings[0]!;
  } catch {
    // Fallback: deterministic pseudo-embedding from text hash
    return hashToEmbedding(text, 384);
  }
}

function hashToEmbedding(text: string, dims: number): number[] {
  const vec = new Array(dims).fill(0);
  const normalized = text.toLowerCase().trim();
  for (let i = 0; i < normalized.length; i++) {
    vec[i % dims] += normalized.charCodeAt(i) / 65536;
  }
  // Normalize to unit length
  const mag = Math.sqrt(vec.reduce((s, v) => s + v * v, 0)) || 1;
  return vec.map(v => v / mag);
}

export function serializeEmbedding(vec: number[]): string {
  return JSON.stringify(vec);
}

export function deserializeEmbedding(json: string): number[] {
  return JSON.parse(json);
}
