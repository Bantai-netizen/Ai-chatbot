# Architecture

Components:
- Frontend (Next.js 14 App Router)
- API (Vercel serverless: Node + Python)
- Neon Postgres with pgvector
- GitHub Actions (ingest, eval, CI)

Data Flow:
1) Content ingestion
   - GitHub Actions triggers scripts/ingest.py
   - Reads /content/*.txt, parses metadata, chunks, embeds with all-MiniLM-L6-v2
   - Upserts into kb_* tables with metadata.hash for idempotency
   - HNSW indexes accelerate cosine similarity

2) Retrieval
   - /api/retrieve/{course|mindset|calls} (Python)
   - Generates query embedding, runs cosine similarity against respective table
   - Returns top 5 results with content, similarity, and metadata for citations

3) Orchestration
   - /api/advise (Node)
   - Heuristic routing determines primary KB and queries secondaries
   - EventSource streaming for UI:
     - Emits step events for observability
     - Streams final answer assembled via the advisory template
   - Guardrails decline low-confidence responses (< 0.65)

4) Frontend UX
   - Left pane: live step badges
   - Main: streamed assistant response
   - Toggle: Server Mode (RAG) vs Direct AI (Puter)
   - Settings: model and thinking vs chat
   - Direct AI uses Puter.js on client (Qwen free models)

Secrets:
- DATABASE_URL set in Vercel env and GitHub Actions secrets
- No credentials in the repo

Deployment:
- vercel.json builds:
  - Next frontend
  - Node serverless functions (*.ts, *.js)
  - Python serverless functions (*.py)
- Routes /api/* to API, others to frontend

Observability:
- Step events and timing emitted to the client
- Extend with logging/metrics as needed in future iterations

Evaluation (planned):
- /api/advise called for 15 prompts (concept, implementation, mindset)
- Collect latency, citation presence, top-1 similarity per KB, and tool-call counts
- Store JSON artifact from eval workflow