# paperscope

A weekday arXiv digest. It scores new `cs.LG` / `cs.AI` / `stat.ML` submissions against a hand-maintained topic list, keeps at most three papers above the similarity threshold, writes them to a Notion reading queue, and delivers the same cards to your phone via Poke.

Notion is the archive. Poke is the delivery. If nothing clears the threshold, nothing is sent.

## Setup

Requires [Bun](https://bun.sh).

```bash
bun install
cp .env.example .env
```

Fill in all four variables in `.env`. Bun loads it automatically.

| Variable | Purpose |
| --- | --- |
| `GEMINI_API_KEY` | Embeddings (`gemini-embedding-001`) and summaries (`gemini-3.5-flash-lite`) from [AI Studio](https://aistudio.google.com/apikey) |
| `NOTION_TOKEN` | Internal integration token with access to the reading-queue database |
| `NOTION_READING_QUEUE_DB` | Database ID for the reading queue |
| `POKE_API_KEY` | V2 inbound key from Poke Kitchen (not a legacy `pk_` key) |

### Notion database

Create a database named Reading Queue with these properties:

| Property | Type |
| --- | --- |
| Title | title |
| Authors | rich_text |
| arXiv ID | rich_text |
| PDF | url |
| TL;DR | rich_text |
| Why relevant | rich_text |
| Score | number |
| Topic match | select |
| Status | status, with an `Inbox` option |
| Added | date |
| Pushed to Poke | checkbox |

Share the database with the integration.

### Topic profile

Edit `pinned-topics.txt`. One interest per line, written as a long descriptive phrase. Blank lines and `#` comments are ignored. Topics are re-embedded on every run.

Short tags like `transformers` match almost everything. Keep the long-line style.

## Commands

```bash
bun test
bun run src/arxiv.ts
bun run src/index.ts --dry-run
bun run src/index.ts --test-push
bun run src/index.ts --force
```

`--dry-run` scores and summarizes but writes nothing to Notion or Poke. `--test-push` sends one fake paper so you can confirm Poke relays the digest verbatim. `--force` bypasses the 08:00 Vienna-hour guard. `--lookback-hours 96` widens the default 24-hour window (useful on weekends).

## Schedule

GitHub Actions runs Monday–Friday at 08:25 Europe/Vienna. Two cron lines cover CET and CEST; the script exits unless the current Vienna hour is 8. Add the four secrets above to the repository, then use **Run workflow** once to confirm a Notion row and a phone message.

The similarity cutoff is `THRESHOLD = 0.35` in `src/config.ts`.
