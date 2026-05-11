import { generateObject } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { z } from 'zod';
import type { QualityScore } from '../types.js';

const qualitySchema = z.object({
  completeness: z.number().min(0).max(1),
  specificity: z.number().min(0).max(1),
  evidence: z.number().min(0).max(1),
  actionability: z.number().min(0).max(1),
  reason: z.string(),
});

/**
 * Evaluate the quality of a potential KB answer.
 */
export async function evaluateQuality(
  questionText: string,
  answerText: string,
  config: import('../config.js').Config,
): Promise<QualityScore> {
  const openrouter = createOpenAI({
    baseURL: config.LLM_BASE_URL,
    apiKey: config.LLM_API_KEY,
  });

  const { object } = await generateObject({
    model: openrouter(config.LLM_MODEL),
    schema: qualitySchema,
    prompt: `Evaluate this answer for a knowledge base about Spanish tax/immigration for nomads.

Question: "${questionText}"
Answer: "${answerText}"

Rate each dimension 0-1:
- completeness: Does it fully address the question?
- specificity: Is it precise (dates, amounts, forms) or vague?
- evidence: Does it cite sources, personal experience, or examples?
- actionability: Can someone act on this information?

Also provide a brief reason.`,
  });

  const scores = object as z.infer<typeof qualitySchema>;
  return {
    completeness: scores.completeness,
    specificity: scores.specificity,
    evidence: scores.evidence,
    actionability: scores.actionability,
    overall: (scores.completeness * 0.4 + scores.specificity * 0.2 + scores.evidence * 0.2 + scores.actionability * 0.2),
  };
}
