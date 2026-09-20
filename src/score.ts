import { MAX_RESULTS, THRESHOLD } from "./config";
import type { ArxivPaper, ScoredPaper, TopicVector } from "./types";

export function cosine(a: number[], b: number[]): number {
  if (a.length === 0 || a.length !== b.length) {
    throw new Error("cosine: vectors must be the same non-zero length");
  }

  let dot = 0;
  let normA = 0;
  let normB = 0;
  for (let i = 0; i < a.length; i++) {
    const x = a[i] ?? 0;
    const y = b[i] ?? 0;
    dot += x * y;
    normA += x * x;
    normB += y * y;
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return dot / denom;
}

export function rankPapers(
  papers: Array<{ paper: ArxivPaper; embedding: number[] }>,
  topics: TopicVector[],
  threshold: number = THRESHOLD,
  limit: number = MAX_RESULTS,
): ScoredPaper[] {
  if (topics.length === 0) return [];

  const scored: ScoredPaper[] = [];

  for (const { paper, embedding } of papers) {
    const matches = topics
      .map((topic) => ({
        topic: topic.name,
        sim: cosine(embedding, topic.embed),
      }))
      .sort((a, b) => b.sim - a.sim);

    const best = matches[0];
    if (!best || !(best.sim > threshold)) continue;

    scored.push({
      ...paper,
      score: best.sim,
      topic: best.topic,
      embedding,
    });
  }

  return scored.sort((a, b) => b.score - a.score).slice(0, limit);
}
