import {
  GEMINI_EMBED_BATCH_PAUSE_MS,
  GEMINI_EMBED_BATCH_SIZE,
  GEMINI_EMBED_DIMENSIONS,
  GEMINI_EMBED_URL,
  GEMINI_EMBEDDING_MODEL,
  GEMINI_RETRY_DELAY_MS,
  loadConfig,
} from "./config";
import type { FetchLike } from "./types";

function l2Normalize(values: number[]): number[] {
  let norm = 0;
  for (const value of values) norm += value * value;
  const scale = Math.sqrt(norm);
  if (scale === 0) return values;
  return values.map((value) => value / scale);
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function retryDelayMs(body: string): number {
  const match = body.match(/"retryDelay":\s*"(\d+)s"/);
  const seconds = match?.[1] ? Number(match[1]) : 0;
  return Math.max(GEMINI_RETRY_DELAY_MS, (seconds + 2) * 1000);
}

async function postEmbedBatch(
  texts: string[],
  fetchFn: FetchLike,
  apiKey: string,
  pause: (ms: number) => Promise<void>,
): Promise<number[][]> {
  const body = {
    requests: texts.map((text) => ({
      model: `models/${GEMINI_EMBEDDING_MODEL}`,
      content: { parts: [{ text }] },
      taskType: "SEMANTIC_SIMILARITY",
      outputDimensionality: GEMINI_EMBED_DIMENSIONS,
    })),
  };

  const init: RequestInit = {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  };

  let response = await fetchFn(GEMINI_EMBED_URL, init);
  if (response.status === 429) {
    const firstBody = await response.text();
    await pause(retryDelayMs(firstBody));
    response = await fetchFn(GEMINI_EMBED_URL, init);
  }

  if (!response.ok) {
    throw new Error(`Gemini embeddings HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    embeddings?: Array<{ values?: number[] }>;
  };
  const embeddings = payload.embeddings ?? [];
  if (embeddings.length !== texts.length) {
    throw new Error(
      `Gemini embeddings expected ${texts.length} vectors, got ${embeddings.length}`,
    );
  }

  return embeddings.map((item, index) => {
    const values = item.values;
    if (!values?.length) {
      throw new Error(`Gemini embeddings response missing values at index ${index}`);
    }
    return l2Normalize(values);
  });
}

export async function embedTexts(
  texts: string[],
  options?: {
    fetch?: FetchLike;
    apiKey?: string;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<number[][]> {
  if (texts.length === 0) return [];

  const apiKey = options?.apiKey ?? loadConfig(["GEMINI_API_KEY"]).geminiApiKey;
  const fetchFn = options?.fetch ?? fetch;
  const pause = options?.sleep ?? sleep;
  const vectors: number[][] = [];

  for (let start = 0; start < texts.length; start += GEMINI_EMBED_BATCH_SIZE) {
    if (start > 0) await pause(GEMINI_EMBED_BATCH_PAUSE_MS);
    const chunk = texts.slice(start, start + GEMINI_EMBED_BATCH_SIZE);
    vectors.push(...(await postEmbedBatch(chunk, fetchFn, apiKey, pause)));
  }

  return vectors;
}
