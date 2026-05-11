import { generateObject } from 'ai';
import { z } from 'zod';
import type { ClassifiedMessage } from '../types.js';

const classificationSchema = z.object({
  type: z.enum(['question', 'answer', 'discussion', 'noise']),
  topic: z.string().optional().describe('Extracted topic keyword or short phrase'),
  confidence: z.number().min(0).max(1),
  reasoning: z.string(),
});

/**
 * Classify a single message using LLM.
 */
export async function classifyMessage(
  text: string,
  llmModel: string,
  googleApiKey?: string,
  _openaiApiKey?: string,
): Promise<ClassifiedMessage> {
  if (!googleApiKey && !_openaiApiKey) throw new Error('No API key for LLM classification');

  const { google } = await import('@ai-sdk/google');
  const model = googleApiKey ? google(llmModel) : (await import('@ai-sdk/openai')).openai(llmModel);

  const { object } = await generateObject({
    model,
    schema: classificationSchema,
    prompt: `Classify this message from a Telegram group about Spanish taxes for digital nomads and expats:

"${text}"

Context:
- "question": Someone asking about taxes, residency, Beckham law, autónomo, NIE, banking, etc.
- "answer": A substantive, informative response that addresses a question with useful detail
- "discussion": General discussion, opinions, follow-up comments — not a direct Q&A pair
- "noise": Greetings, memes, off-topic, short reactions ("thanks", "+1", emojis)

Reply with the classification, optional topic tag, confidence (0-1), and brief reasoning.`,
  });

  return object;
}
