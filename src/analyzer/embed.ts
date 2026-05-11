import { embed } from 'ai';

export async function generateEmbedding(
  text: string,
  provider: 'google' | 'openai',
  model: string,
  _apiKey: string,
): Promise<number[]> {
  let aiModel;
  if (provider === 'google') {
    const { google } = await import('@ai-sdk/google');
    aiModel = google.embedding(model);
  } else {
    const { openai } = await import('@ai-sdk/openai');
    aiModel = openai.embedding(model);
  }

  const { embedding } = await embed({
    model: aiModel,
    value: text.slice(0, 8000),
  });

  return embedding;
}

export async function embedMessage(
  text: string,
  provider: 'google' | 'openai',
  model: string,
  apiKey: string,
): Promise<number[]> {
  if (!text || text.trim().length < 10) return [];

  try {
    return await generateEmbedding(text, provider, model, apiKey);
  } catch (err) {
    console.error('Embedding generation failed:', err);
    return [];
  }
}

export function storeEmbedding(
  raw: import('better-sqlite3').Database,
  messageId: number,
  embedding: number[],
): void {
  raw.prepare(`UPDATE messages SET embedding = ? WHERE id = ?`)
    .run(JSON.stringify(embedding), messageId);
}
