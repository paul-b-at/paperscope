# paperscope — PLAN.md

> Build plan for Cursor. Read top to bottom, implement milestone by milestone.
> Every external service used here is on a **free tier**. Total running cost must stay **€0**.
> No credit card is attached to any account — if a step would require billing, stop and flag it.

---

## 1. What we're building

A daily arXiv digest agent. Every weekday at 08:25 Europe/Vienna it:

1. Fetches yesterday's new submissions from `cs.LG`, `cs.AI`, `stat.ML`.
2. Embeds every abstract and compares it against 5 hand-written topic lines (`pinned-topics.txt`).
3. Keeps papers with cosine score > 0.35, takes the top 3 of the day.
4. Generates a 2-sentence TL;DR and a 1-sentence "why relevant" per paper.
5. Writes them to a Notion database (source of truth / archive).
6. Pushes a compact digest to the phone via the Poke Inbound API.

If no paper clears the threshold: write nothing, push nothing. Never pad to three.

---

## 2. Stack & conventions

| Layer | Pick |
| --- | --- |
| Runtime | **Bun** + TypeScript (strict) |
| Source | arXiv Atom API, `export.arxiv.org/api/query`, no key |
| Embeddings | **Google `gemini-embedding-001`** (free tier) |
| Summaries | **Google `gemini-3.5-flash-lite`** (free tier; `gemini-2.5-flash-lite` is 404 for new keys) |
| Vector store | none — in-memory cosine |
| Storage | Notion database via REST API |
| Delivery | Poke Inbound API |
| Schedule | GitHub Actions cron |

**Hard rules**

- Bun only. `bun install`, `bun run`, `bun test`. No npm/node scripts in `package.json`.
- Use the built-in `fetch`. Do **not** add `node-fetch`, `axios`, `dotenv`, or an SDK wrapper for Gemini/Notion/Poke — plain REST calls against documented endpoints.
- No vector database. 5 topics × ~50 papers/day is an array, not infrastructure.
- Every module that touches an external API lives behind a thin interface so it can be swapped (see §9 fallback).
- All secrets via `process.env`, never committed. `.env.example` documents the names only.

---

## 3. Repo structure

```
paperscope/
├── .github/workflows/daily.yml
├── src/
│   ├── index.ts          # orchestrator
│   ├── arxiv.ts          # fetch + parse Atom → Paper[]
│   ├── embed.ts          # Gemini embeddings (swappable)
│   ├── score.ts          # cosine, threshold, top-N
│   ├── summarize.ts      # Gemini flash-lite TL;DR + why (swappable)
│   ├── notion.ts         # upsert by arXiv ID
│   ├── poke.ts           # pushToPoke with verbatim preamble
│   └── types.ts
├── pinned-topics.txt
├── tests/
├── .env.example
└── README.md
```

---

## 4. Environment variables

```
GEMINI_API_KEY=            # aistudio.google.com/apikey — free tier, no billing account
NOTION_TOKEN=              # internal integration token
NOTION_READING_QUEUE_DB=   # 32-char id from the database URL, before ?v=
POKE_API_KEY=              # V2 key from Poke Kitchen → API Keys → Add API Key
```

All four are GitHub repo secrets with the same names.

---

## 5. Gemini usage (the part that keeps this free)

**Embeddings** — `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-embedding-001:batchEmbedContents`

- Header: `x-goog-api-key: $GEMINI_API_KEY`
- Batch the day's abstracts; also embed the 5 topic lines on every run (cheap, keeps topics always in sync with the file).
- Use `taskType: "SEMANTIC_SIMILARITY"` for both papers and topics — same task type on both sides, otherwise the cosine values are not comparable.
- Set the same `outputDimensionality` for papers and topics, and **L2-normalize** the vectors before cosine if you request a reduced dimensionality.

**Summaries** — `POST https://generativelanguage.googleapis.com/v1beta/models/gemini-3.5-flash-lite:generateContent`

- One call per selected paper (≤ 3/day), returning TL;DR and "why relevant" in a single JSON response.
- Ask for JSON explicitly and parse defensively; on a parse failure fall back to the extractive path in §9 rather than crashing the run.

**Free-tier guardrails**

- Expected volume: ~55 embedding calls and 3 generate calls per run, once per weekday. That is far below any published free-tier limit, but the limits do change — before finalizing, check https://ai.google.dev/gemini-api/docs/rate-limits and confirm both model names still exist on the free tier.
- Free-tier RPD resets at midnight Pacific. Handle `429 RESOURCE_EXHAUSTED` with one retry after 30 s, then give up and send the failure alert — never loop.
- Free tier means Google may use the data for product improvement. arXiv abstracts are public, so this is fine here. Do not send anything private through this key.

---

## 6. Topic profile

`pinned-topics.txt`, one topic per line. Long descriptive lines on purpose — short tags like "transformers" match everything and destroy ranking precision.

```
LLM agents, tool use, function calling, multi-step planning, agent frameworks and orchestration
efficient inference, quantization, small language models, on-device and local LLM deployment, KV-cache and serving optimization
mechanistic interpretability, model internals, probing, feature attribution, circuits and representation analysis
generalization in supervised learning, regularization, calibration, evaluation methodology, distribution shift and overfitting
neuro-symbolic AI, reasoning with LLMs, logic and constraint solving, verification of model outputs
```

No course syllabi, no Notion relations. This file is the only signal source.

---

## 7. Milestones

### M1 — Fetcher (`arxiv.ts`)

Query `cat:cs.LG OR cat:cs.AI OR cat:stat.ML`, sorted by `submittedDate` descending, filtered to the last 24 h. Parse the Atom XML into `Paper { id, title, authors, abstract, pdfUrl, published }`. Dedupe by arXiv ID (strip the version suffix).

*Acceptance:* `bun run src/arxiv.ts` prints 30–200 unique papers with non-empty abstracts, no duplicate IDs.

### M2 — Embeddings (`embed.ts`)

Export `embedTexts(texts: string[]): Promise<number[][]>`. Batch requests, respect the batch size limit, single retry on 429. Embed topics and abstracts through the same function.

*Acceptance:* two near-identical sentences score > 0.9 cosine, two unrelated ones < 0.5.

### M3 — Scorer (`score.ts`)

Cosine similarity of each paper against all 5 topic vectors, keep the best. Filter `sim > 0.35`, sort descending, slice to 3. Return `{ paper, topic, score }[]`, empty array allowed.

*Acceptance:* pure function, unit-tested with fixed vectors, no network calls.

### M4 — Summaries (`summarize.ts`)

For each selected paper, one flash-lite call returning `{ tldr, why }`. TL;DR = 2 sentences max, no "This paper..." opener. Why = 1 sentence naming the matched topic.

*Acceptance:* runs on 3 real abstracts, output is plain text, no markdown, under 300 characters per field.

### M5 — Notion writer (`notion.ts`)

Upsert into the Reading Queue database keyed on `arXiv ID`. Set Title, Authors, arXiv ID, PDF, TL;DR, Why relevant, Score, Topic match, Status = `Inbox`, Added = today. Skip rows where `Pushed to Poke` is already true.

*Acceptance:* running twice in a row creates no duplicates.

> The Notion integration must be added to the Reading Queue database via `···` → Connections, otherwise the API returns 404 even with a valid token.

### M6 — Poke push (`poke.ts`)

`POST https://poke.com/api/v1/inbound/api-message`, `Authorization: Bearer $POKE_API_KEY`, body `{ "message": "..." }`.

The endpoint sends an *instruction* to the Poke agent, not a literal message — so prefix the payload with an explicit relay instruction ("Send the following exactly as written. Do not summarize, rephrase or comment."). After a successful push, set `Pushed to Poke = true` on the Notion rows.

*Acceptance:* `bun run src/index.ts --test-push` sends one fake paper and it arrives verbatim on the phone.

### M7 — Schedule (`daily.yml`)

GitHub Actions runs in UTC and ignores DST, so register both cron lines and guard in code:

```yaml
on:
  schedule:
    - cron: "25 6 * * 1-5"   # 08:25 CEST
    - cron: "25 7 * * 1-5"   # 08:25 CET
```

In `index.ts`, resolve the current Vienna hour with `Intl.DateTimeFormat("de-AT", { timeZone: "Europe/Vienna", hour: "numeric", hour12: false })` and exit 0 unless it is 8 — so the wrong-season run is a no-op instead of a duplicate digest.

Add an `if: failure()` step that curls a short failure message to Poke.

*Acceptance:* manual `workflow_dispatch` completes green end to end.

---

## 8. Flags

- `--dry-run` — full pipeline, prints the digest, writes nothing and pushes nothing.
- `--test-push` — skips arXiv and Gemini, sends one hardcoded fake paper to Poke.
- `--force` — bypasses the Vienna-hour guard, for manual runs.

---

## 9. Zero-API fallback (build the seams now, not the code)

If the Gemini free tier gets throttled or discontinued, the pipeline must survive with zero external AI calls:

| Stage | Replacement | Tradeoff |
| --- | --- | --- |
| Embeddings | `bge-small-en-v1.5` via `fastembed`, CPU, inside the Actions runner (~130 MB model) | +60–90 s per run, quality fine for topic matching |
| TL;DR | Extractive: first 2 sentences of the abstract | Less elegant, but abstracts are summaries already |
| Why relevant | Template: `matches [topic] with score X` | No generated prose, zero dependencies |

Therefore `embed.ts` and `summarize.ts` each expose exactly one exported function and are imported nowhere else by name — swapping either is a one-file change.

---

## 10. Tests (all mocked, no live API calls in CI)

1. `arxiv.test.ts` — parses a saved Atom fixture into the expected `Paper[]`, dedupes versioned IDs.
2. `score.test.ts` — fixed vectors in, known ranking out; verifies the 0.35 threshold and top-3 slice, including the empty-result case.
3. `poke.test.ts` — mocked fetch; asserts the relay preamble is present and no request is sent for an empty paper list.

---

## 11. Out of scope for v1

Weekly recap job, PDF intro extraction, instant high-score pings, web UI, multi-user support, any paid API.

---

## 12. Definition of done

- Runs green on schedule for 3 consecutive weekdays.
- Notion rows appear before the Poke message, never the other way round.
- The digest arrives verbatim on the phone.
- No API key is billable and no credit card is attached anywhere.
- Adding a line to `pinned-topics.txt` changes the next day's results with no other change.
