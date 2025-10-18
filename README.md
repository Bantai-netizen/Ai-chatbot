# Cloud-only ACQ-style Advisor

A fully online multi-agent RAG advisor that runs on:
- Vercel (frontend + serverless API routes)
- Neon Postgres with pgvector
- GitHub Actions for ingestion and evaluation jobs
- Client-side Puter.js for Qwen models (no API keys)

No local dev; everything via PRs, CI, and cloud deploys.

## Repository Structure

- /frontend — Next.js 14 App Router UI
- /api — Vercel serverless API routes
- /scripts — ingestion and eval scripts (used by Actions)
- /content — knowledge base files (txt only)
  - course-transcripts/
  - mindset/transcripts/
  - mindset/worksheets/
  - calls/
- /.github/workflows — CI, ingest, and eval workflows
- vercel.json — monorepo deploy config

## Setup

1) Neon + pgvector
- Create a Neon project and database.
- Add pgvector extension: our setup script enables it automatically; alternatively run:
  CREATE EXTENSION IF NOT EXISTS vector;
- Add DATABASE_URL to both:
  - GitHub repo secrets (Settings → Secrets and variables → Actions): DATABASE_URL
  - Vercel project environment variables: DATABASE_URL

2) Vercel
- Import this repo on Vercel.
- Ensure vercel.json is present to route /api/* to serverless functions and the rest to frontend.

3) GitHub Actions
- The ingestion and eval workflows read secrets and run on schedule and manual triggers.

## Workflows

- CI (.github/workflows/ci.yml)
  - Verifies structure and runs smoke tests.
- Ingest (.github/workflows/ingest.yml)
  - workflow_dispatch + daily.
  - Runs scripts/ingest.py to parse content, chunk, embed, and upsert.
- Eval (.github/workflows/eval.yml)
  - workflow_dispatch + daily.
  - Prepares tests/eval-prompts.json and will call /api/advise to collect metrics in later iteration.

## Database Schema

See scripts/setup-db.sql:
- Tables: kb_course_transcripts, kb_mindset, kb_calls
- Columns: id BIGSERIAL, content TEXT, embedding vector(384), metadata JSONB, source TEXT, created_at TIMESTAMPTZ
- HNSW indexes for cosine search:
  - embedding vector_cosine_ops with parameters (m=16, ef_construction=200)
- GIN indexes on metadata for filtering.

Run this in Neon (e.g., with psql) to create schema.

## Ingestion

scripts/ingest.py:
- Reads .txt files from /content/ subdirs.
- Parses headers and timestamps; keeps speakers.
- Chunks to 500–800 tokens with 100 overlap.
- Embeds with sentence-transformers/all-MiniLM-L6-v2 (384D) and normalizes.
- Idempotency via content hash stored in metadata.hash; upserts by checking existing hash in metadata.

Run via Actions:
- Dispatch the Ingest KB workflow or wait for the daily schedule.

## Retrieval API

Endpoints:
- POST /api/retrieve/course
- POST /api/retrieve/mindset
- POST /api/retrieve/calls

Body: { "query": string, "filters": optional }
- Generates query embedding (same model).
- Cosine similarity over matching table.
- Returns top 5 with { content, similarity, metadata: { module, lesson, timestamp, speaker, source } }.

## Orchestrator

/api/advise
- Tool-calling flow that routes queries using heuristics:
  - concept/strategy → course first
  - belief/motivation/tools → mindset first
  - troubleshooting/examples → calls first
  - falls back to other KBs
- EventSource-compatible streaming:
  - Emits "step" events: "Searching course...", "Searching mindset...", "Searching calls...", "Synthesizing..."
  - Streams final answer tokens using the advisory template.
- Guardrail:
  - If no top chunk has similarity ≥ 0.65, declines with guidance and suggests modules to review.

Note: Synthesis is deterministic template-based initially (no server LLM). Direct AI mode uses Puter.js on the client.

## Frontend

- Next.js App Router UI with:
  - Left pane step badges updating live.
  - Main area streaming assistant response.
  - Toggle: Server Mode (RAG) vs Direct AI (Puter).
  - Settings: model choice and thinking vs chat mode.
- Puter.js integrated via CDN; models:
  - qwen/qwen3-235b-a22b:free (conversational)
  - qwen/qwq-32b:free (deeper reasoning)

Server Mode calls /api/advise?stream=true; Direct AI mode streams via Puter without backend.

## Smoke Tests

- scripts/smoke_tests.js imports /api/health and /api/db-check and performs minimal checks.
- CI installs esbuild-register and runs the smoke tests.

## Acceptance Criteria

- Repo builds on Vercel; /api/health returns 200; /api/db-check confirms pgvector enabled.
- Ingestion workflow ingests sample files from /content into all three tables and logs per-KB counts.
- Retrieval endpoints return 5 results with metadata including timestamp/speaker when available.
- /api/advise streams step events and answer tokens; steps appear in order; frontend renders live.
- Server Mode answers cite module/timestamp or call date; Direct AI mode streams via Puter with no keys.
- Eval workflow JSON artifact (to be implemented) shows: latency ≤ 8s p50, citations present in ≥ 80% answers, and logs tool-call counts.
- All secrets referenced via Actions/Vercel envs; no credentials in repo.

## Troubleshooting

- DATABASE_URL missing:
  - Add to Vercel project env and GitHub Actions secrets.
- pgvector not enabled:
  - Run scripts/setup-db.sql in Neon or enable extension manually.
- Ingestion performance:
  - SentenceTransformer loads model on first run; subsequent runs cache weights.
- Vercel function timeouts:
  - Keep payloads small; avoid loading oversized models server-side. Retrieval endpoints load a small embedding model; acceptable for hobby use but consider warming strategies.
