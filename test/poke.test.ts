import { describe, expect, mock, test } from "bun:test";
import { formatDigest, pushToPoke } from "../src/poke";
import type { EnrichedPaper } from "../src/types";

function fakePaper(overrides: Partial<EnrichedPaper> = {}): EnrichedPaper {
  return {
    id: "2609.00001",
    title: "Agents that plan",
    abstract: "An abstract.",
    authors: ["Ada"],
    pdfUrl: "https://arxiv.org/pdf/2609.00001",
    published: "2026-09-21T00:00:00.000Z",
    score: 0.71,
    topic: "LLM agents, tool use",
    embedding: [1],
    tldr: "Models learn to call tools over multiple steps. Planning quality improves with better memory.",
    why: "Directly about agent frameworks and tool use.",
    ...overrides,
  };
}

describe("formatDigest", () => {
  test("shapes a three-paper digest with the relay instruction", () => {
    const papers = [
      fakePaper(),
      fakePaper({
        id: "2609.00002",
        title: "Tiny models on device",
        pdfUrl: "https://arxiv.org/pdf/2609.00002",
        score: 0.66,
        tldr: "Small models run locally. Quantization keeps quality usable.",
        why: "Matches efficient inference and local deployment.",
      }),
      fakePaper({
        id: "2609.00003",
        title: "Circuits in the residual stream",
        pdfUrl: "https://arxiv.org/pdf/2609.00003",
        score: 0.61,
        tldr: "Features are localized to sparse circuits. Attribution gets more reliable.",
        why: "Matches mechanistic interpretability.",
      }),
    ];

    const body = formatDigest(papers, new Date("2026-09-21T06:25:00.000Z"));

    expect(body.startsWith("Send the following exactly as written. Do not summarize, rephrase or comment.")).toBe(true);
    expect(body).toContain("📄 paperscope — 21.09.2026");
    expect(body).toContain("1. Agents that plan");
    expect(body).toContain("   → Directly about agent frameworks and tool use. (0.71)");
    expect(body).toContain("   https://arxiv.org/pdf/2609.00001");
    expect(body).toContain("2. Tiny models on device");
    expect(body).toContain("3. Circuits in the residual stream");
  });
});

describe("pushToPoke", () => {
  test("returns without calling fetch when the list is empty", async () => {
    const fetchMock = mock(() => {
      throw new Error("fetch should not be called");
    });

    await pushToPoke([], { fetch: fetchMock, skipNotion: true });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
