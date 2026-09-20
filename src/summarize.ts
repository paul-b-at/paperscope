import {
  GEMINI_GENERATE_URL,
  GEMINI_RETRY_DELAY_MS,
  loadConfig,
} from "./config";
import type { EnrichedPaper, FetchLike, ScoredPaper } from "./types";

const PROMPT = `Write a daily arXiv digest card as JSON: {"tldr": string, "why": string}
Rules:
- tldr: at most 2 sentences, plain language, no markdown, do not start with "This paper"
- why: one sentence naming the matched topic
- each field under 300 characters`;

function fallbackSummary(paper: ScoredPaper): { tldr: string; why: string } {
  const sentences = paper.abstract
    .split(/(?<=[.!?])\s+/)
    .map((part) => part.trim())
    .filter(Boolean);
  const tldr =
    sentences.slice(0, 2).join(" ") || paper.abstract.slice(0, 400);
  const topic = paper.topic.split(",")[0]?.trim() ?? paper.topic;
  return {
    tldr,
    why: `matches ${topic} with score ${paper.score.toFixed(2)}`,
  };
}

function parseSummary(raw: string): { tldr: string; why: string } | null {
  try {
    const parsed = JSON.parse(raw) as { tldr?: unknown; why?: unknown };
    if (
      typeof parsed.tldr === "string" &&
      typeof parsed.why === "string" &&
      parsed.tldr.trim() &&
      parsed.why.trim()
    ) {
      return { tldr: parsed.tldr.trim(), why: parsed.why.trim() };
    }
    return null;
  } catch {
    return null;
  }
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function generateJson(
  paper: ScoredPaper,
  fetchFn: FetchLike,
  apiKey: string,
  pause: (ms: number) => Promise<void>,
): Promise<string> {
  const init: RequestInit = {
    method: "POST",
    headers: {
      "x-goog-api-key": apiKey,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      contents: [
        {
          parts: [
            {
              text: [
                PROMPT,
                `Title: ${paper.title}`,
                `Abstract: ${paper.abstract}`,
                `Matched topic: ${paper.topic}`,
              ].join("\n"),
            },
          ],
        },
      ],
      generationConfig: {
        temperature: 0.3,
        responseMimeType: "application/json",
      },
    }),
  };

  let response = await fetchFn(GEMINI_GENERATE_URL, init);
  if (response.status === 429) {
    await pause(GEMINI_RETRY_DELAY_MS);
    response = await fetchFn(GEMINI_GENERATE_URL, init);
  }

  if (!response.ok) {
    throw new Error(`Gemini generate HTTP ${response.status}: ${await response.text()}`);
  }

  const payload = (await response.json()) as {
    candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }>;
  };
  return payload.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

export async function summarize(
  papers: ScoredPaper[],
  options?: {
    fetch?: FetchLike;
    apiKey?: string;
    sleep?: (ms: number) => Promise<void>;
  },
): Promise<EnrichedPaper[]> {
  const apiKey = options?.apiKey ?? loadConfig(["GEMINI_API_KEY"]).geminiApiKey;
  const fetchFn = options?.fetch ?? fetch;
  const pause = options?.sleep ?? sleep;
  const enriched: EnrichedPaper[] = [];

  for (const paper of papers) {
    try {
      const parsed = parseSummary(await generateJson(paper, fetchFn, apiKey, pause));
      if (parsed) {
        enriched.push({ ...paper, ...parsed });
        continue;
      }
      console.warn(`Gemini summary parse failed for ${paper.id}; using extractive fallback`);
      enriched.push({ ...paper, ...fallbackSummary(paper) });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (message.includes("HTTP 429")) throw error;
      console.warn(`Gemini summary failed for ${paper.id}: ${message}`);
      enriched.push({ ...paper, ...fallbackSummary(paper) });
    }
  }

  return enriched;
}
