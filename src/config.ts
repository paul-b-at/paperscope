import { join } from "node:path";

export const THRESHOLD = 0.35;
export const MAX_RESULTS = 3;
export const ARXIV_MAX_RESULTS = 200;
export const ARXIV_CATEGORIES = "cat:cs.LG+OR+cat:cs.AI+OR+cat:stat.ML";
export const ARXIV_URL = "https://export.arxiv.org/api/query";
export const ARXIV_RETRY_DELAY_MS = 3000;
export const GEMINI_EMBEDDING_MODEL = "gemini-embedding-001";
export const GEMINI_CHAT_MODEL = "gemini-3.5-flash-lite";
export const GEMINI_EMBED_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents";
export const GEMINI_GENERATE_URL =
  "https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent";
export const MAX_EMBED_PAPERS = 90;
export const GEMINI_EMBED_DIMENSIONS = 768;
export const GEMINI_EMBED_BATCH_SIZE = 90;
export const GEMINI_EMBED_BATCH_PAUSE_MS = 65_000;
export const GEMINI_RETRY_DELAY_MS = 30_000;
export const POKE_INBOUND_URL = "https://poke.com/api/v1/inbound/api-message";
export const VIENNA_TZ = "Europe/Vienna";
export const LOOKBACK_MS = 24 * 60 * 60 * 1000;

export const ENV_KEYS = [
  "GEMINI_API_KEY",
  "NOTION_TOKEN",
  "NOTION_READING_QUEUE_DB",
  "POKE_API_KEY",
] as const;

export type EnvKey = (typeof ENV_KEYS)[number];

export type Config = {
  geminiApiKey: string;
  notionToken: string;
  notionReadingQueueDb: string;
  pokeApiKey: string;
};

const ROOT = join(import.meta.dir, "..");

export function projectPath(...parts: string[]): string {
  return join(ROOT, ...parts);
}

export const TOPICS_PATH = projectPath("pinned-topics.txt");

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    throw new Error(`Missing required environment variable: ${name}`);
  }
  return value;
}

export function loadConfig(required: readonly EnvKey[] = ENV_KEYS): Config {
  const get = (key: EnvKey): string =>
    required.includes(key) ? requireEnv(key) : (process.env[key] ?? "");

  return {
    geminiApiKey: get("GEMINI_API_KEY"),
    notionToken: get("NOTION_TOKEN"),
    notionReadingQueueDb: get("NOTION_READING_QUEUE_DB"),
    pokeApiKey: get("POKE_API_KEY"),
  };
}

export function viennaDateLabel(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: VIENNA_TZ,
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  }).formatToParts(date);

  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  return `${day}.${month}.${year}`;
}

export function viennaIsoDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: VIENNA_TZ,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);

  const year = parts.find((part) => part.type === "year")?.value ?? "1970";
  const month = parts.find((part) => part.type === "month")?.value ?? "01";
  const day = parts.find((part) => part.type === "day")?.value ?? "01";
  return `${year}-${month}-${day}`;
}
