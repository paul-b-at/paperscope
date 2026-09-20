import { XMLParser } from "fast-xml-parser";
import {
  ARXIV_CATEGORIES,
  ARXIV_MAX_RESULTS,
  ARXIV_RETRY_DELAY_MS,
  ARXIV_URL,
  LOOKBACK_MS,
} from "./config";
import type { ArxivPaper, FetchLike } from "./types";

type AtomLink = {
  "@_href"?: string;
  "@_rel"?: string;
  "@_type"?: string;
  "@_title"?: string;
};

type AtomAuthor = {
  name?: string;
};

type AtomEntry = {
  id?: unknown;
  title?: unknown;
  summary?: unknown;
  published?: unknown;
  author?: AtomAuthor[];
  link?: AtomLink[];
};

const parser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  processEntities: true,
  isArray: (name) => ["entry", "author", "link", "category"].includes(name),
});

const USER_AGENT = "paperscope/1.0 (daily arxiv digest; mailto:paperscope@local)";

export function normalizeArxivId(raw: string): string {
  const last = raw.split("/").pop() ?? raw;
  return last.replace(/v\d+$/i, "");
}

export function normalizeText(value: string): string {
  return decodeEntities(value).replace(/\s+/g, " ").trim();
}

function decodeEntities(value: string): string {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#39;/g, "'")
    .replace(/&#x([0-9a-fA-F]+);/g, (_, hex: string) =>
      String.fromCharCode(parseInt(hex, 16)),
    )
    .replace(/&#(\d+);/g, (_, dec: string) =>
      String.fromCharCode(Number(dec)),
    );
}

function textOf(value: unknown): string {
  if (typeof value === "string") return value;
  if (value && typeof value === "object" && "#text" in value) {
    const text = (value as { "#text": unknown })["#text"];
    return typeof text === "string" ? text : "";
  }
  return "";
}

function pdfUrlFrom(entry: AtomEntry, id: string): string {
  const links = entry.link ?? [];
  const pdf = links.find(
    (link) =>
      link["@_title"] === "pdf" || link["@_type"] === "application/pdf",
  );
  return pdf?.["@_href"] ?? `https://arxiv.org/pdf/${id}`;
}

function authorsOf(entry: AtomEntry): string[] {
  return (entry.author ?? [])
    .map((author) => normalizeText(author.name ?? ""))
    .filter(Boolean);
}

export function parseAtomFeed(xml: string): ArxivPaper[] {
  const parsed = parser.parse(xml) as { feed?: { entry?: AtomEntry[] } };
  const entries = parsed.feed?.entry ?? [];

  return entries.flatMap((entry) => {
    const id = normalizeArxivId(textOf(entry.id));
    const title = normalizeText(textOf(entry.title));
    const abstract = normalizeText(textOf(entry.summary));
    const published = textOf(entry.published);
    if (!id || !title || !published) return [];

    const paper: ArxivPaper = {
      id,
      title,
      abstract,
      authors: authorsOf(entry),
      pdfUrl: pdfUrlFrom(entry, id),
      published: new Date(published).toISOString(),
    };
    return [paper];
  });
}

export function filterRecent(
  papers: ArxivPaper[],
  now: Date = new Date(),
  windowMs: number = LOOKBACK_MS,
): ArxivPaper[] {
  const cutoff = now.getTime() - windowMs;
  return papers.filter((paper) => {
    const published = Date.parse(paper.published);
    return Number.isFinite(published) && published >= cutoff;
  });
}

export function dedupeById(papers: ArxivPaper[]): ArxivPaper[] {
  const seen = new Set<string>();
  const unique: ArxivPaper[] = [];
  for (const paper of papers) {
    if (seen.has(paper.id)) continue;
    seen.add(paper.id);
    unique.push(paper);
  }
  return unique;
}

async function sleep(ms: number): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchArxivXml(
  fetchFn: FetchLike,
  pause: (ms: number) => Promise<void>,
): Promise<string> {
  const url = `${ARXIV_URL}?search_query=${ARXIV_CATEGORIES}&sortBy=submittedDate&sortOrder=descending&max_results=${ARXIV_MAX_RESULTS}`;

  const attempt = async (): Promise<string> => {
    const response = await fetchFn(url, {
      headers: { "User-Agent": USER_AGENT },
    });
    if (!response.ok) {
      const body = await response.text();
      throw new Error(`arXiv HTTP ${response.status}: ${body}`);
    }
    return response.text();
  };

  try {
    return await attempt();
  } catch {
    await pause(ARXIV_RETRY_DELAY_MS);
    return attempt();
  }
}

export async function fetchRecent(options?: {
  fetch?: FetchLike;
  now?: Date;
  windowMs?: number;
  sleep?: (ms: number) => Promise<void>;
}): Promise<ArxivPaper[]> {
  const xml = await fetchArxivXml(options?.fetch ?? fetch, options?.sleep ?? sleep);
  return dedupeById(filterRecent(parseAtomFeed(xml), options?.now, options?.windowMs));
}

if (import.meta.main) {
  const papers = await fetchRecent();
  console.error(`recent papers: ${papers.length}`);
  console.log(JSON.stringify(papers, null, 2));
}
