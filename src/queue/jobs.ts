export interface ClassifyJob {
  messageId: number;
  text: string;
}

export interface EmbedJob {
  messageId: number;
  text: string;
  classification: string;
  topic?: string;
  confidence: number;
}

export interface KBJob {
  messageId: number;
  text: string;
  embedding: number[];
  classification: string;
  topic?: string;
  confidence: number;
  userId: number | null;
  reactionsCount: number;
  tgMessageId: number;
}
