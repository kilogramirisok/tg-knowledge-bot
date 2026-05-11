import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import type { ClassifiedMessage } from '../types.js';

const classificationSchema = z.object({
  type: z.enum(['question', 'answer', 'discussion', 'noise']),
  topic: z.string().optional(),
  confidence: z.number().min(0).max(1),
  reason: z.string(),
});

/**
 * Classify a message using LLM.
 * Uses OpenRouter (OpenAI-compatible) via AI SDK.
 */
export async function classifyMessage(
  text: string,
  baseUrl: string,
  apiKey: string,
  model: string,
): Promise<ClassifiedMessage> {
  const openrouter = createOpenAI({
    baseURL: baseUrl,
    apiKey,
  });

  const { object } = await generateObject({
    model: openrouter(model),
    schema: classificationSchema,
    prompt: `Classify this Telegram group message from a tax/immigration community for Spain-based nomads.

Message: "${text}"

Categories:
- "question": Asks for help/advice (explicit or implicit)
- "answer": Provides substantive information answering a question
- "discussion": General discussion, opinions, follow-up
- "noise": Off-topic, memes, greetings, "thanks", very short

Reply with type, topic (main subject in 2-5 words if applicable), confidence (0-1), and brief reason.`,
  });

  return object as ClassifiedMessage;
}
