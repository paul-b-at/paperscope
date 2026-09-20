import { describe, expect, test } from "bun:test";
import { cosine, rankPapers } from "../src/score";
import type { ArxivPaper, TopicVector } from "../src/types";

function paper(id: string): ArxivPaper {
  return {
    id,
    title: `Paper ${id}`,
    abstract: `Abstract ${id}`,
    authors: ["A"],
    pdfUrl: `https://arxiv.org/pdf/${id}`,
    published: "2026-09-20T00:00:00.000Z",
  };
}

const topics: TopicVector[] = [
  { name: "agents", embed: [1, 0, 0] },
  { name: "inference", embed: [0, 1, 0] },
];

describe("cosine", () => {
  test("is 1 for parallel vectors even when unnormalized", () => {
    expect(cosine([2, 0], [4, 0])).toBeCloseTo(1);
  });

  test("is 0 for orthogonal vectors", () => {
    expect(cosine([1, 0], [0, 1])).toBeCloseTo(0);
  });
});

function unit(x: number, y = 0): number[] {
  return [x, y, Math.sqrt(Math.max(0, 1 - x * x - y * y))];
}

describe("rankPapers", () => {
  test("orders by best topic similarity", () => {
    const ranked = rankPapers(
      [
        { paper: paper("low"), embedding: unit(0.4) },
        { paper: paper("high"), embedding: [0, 1, 0] },
      ],
      topics,
      0.35,
    );

    expect(ranked.map((item) => item.id)).toEqual(["high", "low"]);
    expect(ranked[0]?.topic).toBe("inference");
    expect(ranked[0]?.score).toBeCloseTo(1);
    expect(ranked[1]?.topic).toBe("agents");
    expect(ranked[1]?.score).toBeCloseTo(0.4, 2);
  });

  test("drops papers at or below the threshold", () => {
    const onlyAgents: TopicVector[] = [{ name: "agents", embed: [1, 0, 0] }];
    const ranked = rankPapers(
      [
        { paper: paper("edge"), embedding: unit(0.35) },
        { paper: paper("below"), embedding: unit(0.2) },
        { paper: paper("above"), embedding: unit(0.36) },
      ],
      onlyAgents,
      0.35,
    );

    expect(ranked.map((item) => item.id)).toEqual(["above"]);
    expect(ranked[0]?.score).toBeGreaterThan(0.35);
  });

  test("caps the daily list at 3", () => {
    const onlyAgents: TopicVector[] = [{ name: "agents", embed: [1, 0, 0] }];
    const ranked = rankPapers(
      [0.9, 0.8, 0.7, 0.6, 0.5].map((score, index) => ({
        paper: paper(`p${index}`),
        embedding: unit(score),
      })),
      onlyAgents,
      0.35,
      3,
    );

    expect(ranked).toHaveLength(3);
    expect(ranked.map((item) => item.id)).toEqual(["p0", "p1", "p2"]);
  });

  test("returns an empty list when nothing clears the threshold", () => {
    const ranked = rankPapers(
      [{ paper: paper("none"), embedding: unit(0.1) }],
      [{ name: "agents", embed: [1, 0, 0] }],
    );
    expect(ranked).toEqual([]);
  });
});
