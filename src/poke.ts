import { loadConfig, POKE_INBOUND_URL, viennaDateLabel } from "./config";
import { findPaperRow, markPushed } from "./notion";
import type { EnrichedPaper, FetchLike } from "./types";

export function formatDigest(papers: EnrichedPaper[], date: Date = new Date()): string {
  const lines = [
    "Send the following exactly as written. Do not summarize, rephrase or comment.",
    "",
    `📄 paperscope — ${viennaDateLabel(date)}`,
    "",
  ];

  papers.forEach((paper, index) => {
    lines.push(
      `${index + 1}. ${paper.title}`,
      `   ${paper.tldr}`,
      `   → ${paper.why} (${paper.score.toFixed(2)})`,
      `   ${paper.pdfUrl}`,
      "",
    );
  });

  return lines.join("\n").trimEnd();
}

export async function sendPokeMessage(
  message: string,
  options?: { fetch?: FetchLike; apiKey?: string },
): Promise<void> {
  const apiKey = options?.apiKey ?? loadConfig(["POKE_API_KEY"]).pokeApiKey;
  const fetchFn = options?.fetch ?? fetch;

  const response = await fetchFn(POKE_INBOUND_URL, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ message }),
  });

  if (response.status < 200 || response.status >= 300) {
    throw new Error(`Poke HTTP ${response.status}: ${await response.text()}`);
  }
}

export async function pushToPoke(
  papers: EnrichedPaper[],
  options?: {
    fetch?: FetchLike;
    apiKey?: string;
    now?: Date;
    skipNotion?: boolean;
  },
): Promise<void> {
  if (papers.length === 0) return;

  const unpushed: Array<{ paper: EnrichedPaper; pageId?: string }> = [];

  if (options?.skipNotion) {
    unpushed.push(...papers.map((paper) => ({ paper })));
  } else {
    for (const paper of papers) {
      const row = await findPaperRow(paper.id);
      if (!row || row.pushed) continue;
      unpushed.push({ paper, pageId: row.pageId });
    }
  }

  if (unpushed.length === 0) return;

  await sendPokeMessage(
    formatDigest(
      unpushed.map((item) => item.paper),
      options?.now,
    ),
    options,
  );

  if (!options?.skipNotion) {
    for (const item of unpushed) {
      if (item.pageId) await markPushed(item.pageId);
    }
  }
}

export const TEST_PUSH_PAPER: EnrichedPaper = {
  id: "0000.00000",
  title: "paperscope test ping",
  abstract: "Connectivity check for the daily digest pipeline.",
  authors: ["paperscope"],
  pdfUrl: "https://arxiv.org/pdf/0000.00000",
  published: "2026-09-21T00:00:00.000Z",
  score: 0.99,
  topic: "test",
  embedding: [],
  tldr: "This is a test digest from paperscope. Formatting should arrive intact.",
  why: "Verifies the Poke relay instruction.",
};
