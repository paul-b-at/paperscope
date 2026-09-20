import { Client } from "@notionhq/client";
import { loadConfig, viennaIsoDate } from "./config";
import type { EnrichedPaper } from "./types";

export type NotionPaperRow = {
  pageId: string;
  pushed: boolean;
};

const dataSourceCache = new Map<string, string>();

function richText(content: string): { rich_text: Array<{ text: { content: string } }> } {
  return { rich_text: [{ text: { content: content.slice(0, 2000) } }] };
}

export function formatAuthors(authors: string[]): string {
  if (authors.length <= 3) return authors.join(", ");
  return `${authors.slice(0, 3).join(", ")} et al.`;
}

export function topicSelectName(topic: string): string {
  const clause = topic.split(",")[0]?.trim() || topic;
  return clause.slice(0, 100);
}

function checkboxOf(page: unknown): boolean {
  if (!page || typeof page !== "object" || !("properties" in page)) return false;
  const properties = (page as {
    properties?: Record<string, { type?: string; checkbox?: boolean }>;
  }).properties;
  const property = properties?.["Pushed to Poke"];
  return property?.type === "checkbox" ? Boolean(property.checkbox) : false;
}

export function createNotionClient(token?: string): Client {
  return new Client({ auth: token ?? loadConfig(["NOTION_TOKEN"]).notionToken });
}

async function resolveDataSourceId(
  client: Client,
  databaseId: string,
): Promise<string> {
  const cached = dataSourceCache.get(databaseId);
  if (cached) return cached;

  const database = await client.databases.retrieve({ database_id: databaseId });
  if (!("data_sources" in database) || !database.data_sources[0]) {
    throw new Error(`Notion database ${databaseId} has no data sources`);
  }

  const dataSourceId = database.data_sources[0].id;
  dataSourceCache.set(databaseId, dataSourceId);
  return dataSourceId;
}

export async function findPaperRow(
  arxivId: string,
  options?: { client?: Client; databaseId?: string },
): Promise<NotionPaperRow | null> {
  const databaseId =
    options?.databaseId ?? loadConfig(["NOTION_TOKEN", "NOTION_READING_QUEUE_DB"]).notionReadingQueueDb;
  const client = options?.client ?? createNotionClient();
  const dataSourceId = await resolveDataSourceId(client, databaseId);

  const result = await client.dataSources.query({
    data_source_id: dataSourceId,
    filter: {
      property: "arXiv ID",
      rich_text: { equals: arxivId },
    },
  });

  const page = result.results[0];
  if (!page || typeof page !== "object" || !("id" in page)) return null;
  return { pageId: String(page.id), pushed: checkboxOf(page) };
}

function pageProperties(paper: EnrichedPaper, added: string) {
  return {
    Title: { title: [{ text: { content: paper.title.slice(0, 2000) } }] },
    Authors: richText(formatAuthors(paper.authors)),
    "arXiv ID": richText(paper.id),
    PDF: { url: paper.pdfUrl },
    "TL;DR": richText(paper.tldr),
    "Why relevant": richText(paper.why),
    Score: { number: Number(paper.score.toFixed(3)) },
    "Topic match": { select: { name: topicSelectName(paper.topic) } },
    Status: { status: { name: "Inbox" } },
    Added: { date: { start: added } },
    "Pushed to Poke": { checkbox: false },
  };
}

export async function writeToNotion(
  papers: EnrichedPaper[],
  options?: { client?: Client; databaseId?: string; now?: Date },
): Promise<void> {
  const databaseId =
    options?.databaseId ??
    loadConfig(["NOTION_TOKEN", "NOTION_READING_QUEUE_DB"]).notionReadingQueueDb;
  const client = options?.client ?? createNotionClient();
  const added = viennaIsoDate(options?.now);
  const errors: Error[] = [];

  for (const paper of papers) {
    try {
      const existing = await findPaperRow(paper.id, { client, databaseId });
      if (existing) continue;

      await client.pages.create({
        parent: { database_id: databaseId },
        properties: pageProperties(paper, added),
      });
    } catch (error) {
      errors.push(error instanceof Error ? error : new Error(String(error)));
    }
  }

  if (errors.length > 0) {
    throw new Error(
      `Notion write failed for ${errors.length} paper(s): ${errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
}

export async function markPushed(
  pageId: string,
  options?: { client?: Client },
): Promise<void> {
  const client = options?.client ?? createNotionClient();
  await client.pages.update({
    page_id: pageId,
    properties: {
      "Pushed to Poke": { checkbox: true },
    },
  });
}
