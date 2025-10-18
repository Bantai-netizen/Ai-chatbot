# API

This directory will host Vercel serverless API routes for:
- /api/health (smoke check)
- /api/db-check (pgvector enabled check)
- /api/retrieve/course
- /api/retrieve/mindset
- /api/retrieve/calls
- /api/advise (LangChain/LangGraph orchestrator with tool-calling)

Notes:
- Uses Neon Postgres via DATABASE_URL configured in Vercel project environment (never committed).
- Streaming responses will be EventSource-compatible from /api/advise.