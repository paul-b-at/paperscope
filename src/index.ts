import { fetchRecent } from "./arxiv";
import { loadConfig, LOOKBACK_MS, MAX_EMBED_PAPERS, TOPICS_PATH } from "./config";
import { embedTexts } from "./embed";
import { writeToNotion } from "./notion";
import { pushToPoke, TEST_PUSH_PAPER } from "./poke";
import { rankPapers } from "./score";
import { summarize } from "./summarize";
import type { TopicVector } from "./types";

function parseLookbackHours(argv: string[]): number | undefined {
  const paired = argv.find((arg) => arg.startsWith("--lookback-hours="));
  if (paired) {
    const value = Number(paired.slice("--lookback-hours=".length));
    if (!Number.isFinite(value) || value <= 0) {
      throw new Error("--lookback-hours must be a positive number");
    }
    return value;
  }

  const index = argv.indexOf("--lookback-hours");
  if (index === -1) return undefined;
  const value = Number(argv[index + 1]);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error("--lookback-hours must be a positive number");
  }
  return value;
}

function parseFlags(argv: string[]): {
  dryRun: boolean;
  testPush: boolean;
  lookbackMs: number;
} {
  const hours = parseLookbackHours(argv);
  return {
    dryRun: argv.includes("--dry-run"),
    testPush: argv.includes("--test-push"),
    lookbackMs: hours ? hours * 60 * 60 * 1000 : LOOKBACK_MS,
  };
}

function parseTopicLines(raw: string): string[] {
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

function printDryRun(
  papers: Array<{
    id: string;
    title: string;
    score: number;
    topic: string;
    tldr: string;
    why: string;
    pdfUrl: string;
  }>,
): void {
  for (const [index, paper] of papers.entries()) {
    console.log(`${index + 1}. ${paper.title}`);
    console.log(`   id: ${paper.id}`);
    console.log(`   score: ${paper.score.toFixed(3)}`);
    console.log(`   topic: ${paper.topic}`);
    console.log(`   tldr: ${paper.tldr}`);
    console.log(`   why: ${paper.why}`);
    console.log(`   pdf: ${paper.pdfUrl}`);
    console.log("");
  }
}

async function scoreAndRank(papers: Awaited<ReturnType<typeof fetchRecent>>) {
  const topicLines = parseTopicLines(await Bun.file(TOPICS_PATH).text());
  const topicEmbeds = await embedTexts(topicLines);
  const topics: TopicVector[] = topicLines.map((name, index) => {
    const embed = topicEmbeds[index];
    if (!embed) throw new Error(`Missing embedding for topic: ${name}`);
    return { name, embed };
  });

  const paperEmbeds = await embedTexts(papers.map((paper) => paper.abstract));
  return rankPapers(
    papers.map((paper, index) => {
      const embedding = paperEmbeds[index];
      if (!embedding) throw new Error(`Missing embedding for paper ${paper.id}`);
      return { paper, embedding };
    }),
    topics,
  );
}

export async function run(argv: string[] = process.argv.slice(2)): Promise<void> {
  const { dryRun, testPush, lookbackMs } = parseFlags(argv);

  if (testPush) {
    loadConfig(["POKE_API_KEY"]);
    await pushToPoke([TEST_PUSH_PAPER], { skipNotion: true });
    console.log("test push sent");
    return;
  }

  if (dryRun) {
    loadConfig(["GEMINI_API_KEY"]);
  } else {
    loadConfig();
  }

  const fetched = await fetchRecent({ windowMs: lookbackMs });
  const papers = fetched.slice(0, MAX_EMBED_PAPERS);
  console.log(
    `fetched ${fetched.length} papers in the last ${lookbackMs / 3600000}h; embedding ${papers.length}`,
  );
  if (papers.length === 0) {
    console.log("no recent papers");
    return;
  }

  const scored = await scoreAndRank(papers);
  if (scored.length === 0) {
    console.log("nothing above threshold");
    return;
  }

  const enriched = await summarize(scored);

  if (dryRun) {
    printDryRun(enriched);
    return;
  }

  await writeToNotion(enriched);
  await pushToPoke(enriched);
}

if (import.meta.main) {
  await run();
}
