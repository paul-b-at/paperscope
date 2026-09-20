import { describe, expect, mock, test } from "bun:test";
import { join } from "node:path";
import {
  dedupeById,
  fetchRecent,
  filterRecent,
  normalizeArxivId,
  parseAtomFeed,
} from "../src/arxiv";

const fixture = await Bun.file(
  join(import.meta.dir, "fixtures", "arxiv-response.xml"),
).text();

describe("normalizeArxivId", () => {
  test("strips the version suffix", () => {
    expect(normalizeArxivId("http://arxiv.org/abs/2609.01234v2")).toBe(
      "2609.01234",
    );
    expect(normalizeArxivId("2609.01234v1")).toBe("2609.01234");
  });
});

describe("parseAtomFeed", () => {
  const papers = parseAtomFeed(fixture);

  test("extracts core fields", () => {
    const first = papers[0];
    expect(first?.id).toBe("2609.01234");
    expect(first?.authors).toEqual(["Jane Doe", "John Smith"]);
    expect(first?.pdfUrl).toBe("https://arxiv.org/pdf/2609.01234v2");
    expect(first?.published).toBe("2026-09-20T08:00:00.000Z");
  });

  test("collapses title whitespace and decodes XML entities", () => {
    const first = papers[0];
    expect(first?.title).toBe("Attention & Transformers: a newline title");
    expect(first?.abstract).toBe(
      'We study attention. This abstract mentions <graphs> and quotes "agents".',
    );
    expect(first?.title.includes("&amp;")).toBe(false);
    expect(first?.abstract.includes("&lt;")).toBe(false);
  });

  test("keeps versioned duplicates until dedupe", () => {
    expect(papers.filter((paper) => paper.id === "2609.01234")).toHaveLength(2);
  });
});

describe("filter and dedupe", () => {
  const papers = parseAtomFeed(fixture);
  const now = new Date("2026-09-20T12:00:00.000Z");

  test("keeps only papers from the last 24 hours", () => {
    const recent = filterRecent(papers, now);
    expect(recent.map((paper) => paper.id)).toEqual([
      "2609.01234",
      "2609.05678",
    ]);
  });

  test("deduplicates by arXiv id, keeping the first (newest) copy", () => {
    const unique = dedupeById(filterRecent(papers, now));
    expect(unique.map((paper) => paper.id)).toEqual([
      "2609.01234",
      "2609.05678",
    ]);
    expect(unique[0]?.title).toBe("Attention & Transformers: a newline title");
  });

  test("fetchRecent uses a mocked feed and never hits the network", async () => {
    const fetchMock = mock(() => Promise.resolve(new Response(fixture, { status: 200 })));
    const recent = await fetchRecent({
      fetch: fetchMock,
      now,
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(recent.map((paper) => paper.id)).toEqual([
      "2609.01234",
      "2609.05678",
    ]);
  });
});
