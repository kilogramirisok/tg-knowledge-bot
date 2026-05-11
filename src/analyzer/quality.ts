import { generateObject } from 'ai';
import { z } from 'zod';
import type { QualityScore } from '../types.js';
import { getLogger } from '../utils/logger.js';

const logger = getLogger();

const qualitySchema = z.object({
  completeness: z.number().min(0).max(1)
    .describe('Does the message fully address the question/topic?'),
  specificity: z.number().min(0).max(1)
    .describe('Is it specific with details, or vague?'),
  actionable: z.number().min(0).max(1)
    .describe('Does it provide actionable steps or concrete information?'),
  reasoning: z.string(),
});

/**
 * Score the quality of an answer-classified message using LLM.
 */
export async function scoreQuality(
  text: string,
  llmModel: string,
  googleApiKey?: string,
  openaiApiKey?: string,
): Promise<QualityScore> {
  const apiKey = googleApiKey ?? openaiApiKey;
  if (!apiKey) throw new Error('No API key for quality scoring');

  const { google } = await import('@ai-sdk/google');
  const model = googleApiKey ? google(llmModel) : (await import('@ai-sdk/openai')).openai(llmModel);

  const { object } = await generateObject({
    model,
    schema: qualitySchema,
    prompt: `Score the quality of this answer from a Spanish tax/nomad Telegram group on a 0-1 scale:

"${text}"

Consider:
- completeness: Does it provide a thorough answer?
- specificity: Concrete details vs vague generalities?
- actionable: Can someone act on this information?

Be strict. Average community messages should score 0.3-0.5. Only truly excellent, comprehensive answers should score above 0.8.`,
  });

  const overall = (object.completeness + object.specificity + object.actionable) / 3;

  return {
    completeness: object.completeness,
    specificity: object.specificity,
    actionable: object.actionable,
    overall,
    reasoning: object.reasoning,
  };
}

/**
 * Calculate the final KB inclusion score.
 * Combines answer quality, user reputation, community signals, and recency.
 */
export function calculateFinalScore(params: {
  qualityScore: number;       // 0-1 from LLM
  userReputation: number;     // 0-1 from reputation engine
  communitySignal: number;    // 0-1 normalized reactions
  recencyScore: number;       // 0-1 exponential decay
  sourceDiversity: number;    // 0-1 multiple contributors
}): number {
  return (
    0.30 * params.qualityScore +
    0.25 * params.userReputation +
    0.20 * params.communitySignal +
    0.15 * params.recencyScore +
    0.10 * params.sourceDiversity
  );
}

/**
 * Calculate recency score with exponential decay.
 * Full score at now, decays to 0.5 after ~30 days.
 */
export function recencyScore(timestamp: Date, now: Date = new Date()): number {
  const ageMs = now.getTime() - timestamp.getTime();
  const ageDays = ageMs / (1000 * 60 * 60 * 24);
  const halfLife = 30; // days
  return Math.exp(-0.693 * ageDays / halfLife);
}
