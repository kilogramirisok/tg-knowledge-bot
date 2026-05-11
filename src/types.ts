export type MessageClassification = 'question' | 'answer' | 'discussion' | 'noise';

export interface ClassifiedMessage {
  type: MessageClassification;
  topic?: string;
  confidence: number;
  reasoning: string;
}

export interface QualityScore {
  completeness: number;
  specificity: number;
  actionable: number;
  overall: number;
  reasoning: string;
}

export interface DedupResult {
  isDuplicate: boolean;
  similarEntryId?: number;
  similarity: number;
  shouldMerge: boolean;
}

export interface ReputationWeights {
  activity: number;
  expertise: number;
  curation: number;
  recency: number;
}

export const DEFAULT_REPUTATION_WEIGHTS: ReputationWeights = {
  activity: 0.30,
  expertise: 0.25,
  curation: 0.25,
  recency: 0.20,
};

export const QUALITY_THRESHOLD = 0.6;
export const DEDUP_SIMILARITY_THRESHOLD = 0.85;
