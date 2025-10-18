# Scripts

This directory will contain ingestion and evaluation scripts executed via GitHub Actions.

Planned scripts:
- ingest.py: Reads content from /content/*, chunks transcripts, generates embeddings, and upserts into Neon pgvector tables.
- eval.py (optional): Runs evaluation prompts against /api/advise and collects metrics.
- setup-db.sql: SQL migration to enable pgvector and create KB tables with HNSW indexes.

Execution:
- Triggered by workflow_dispatch and scheduled runs from .github/workflows/ingest.yml and eval.yml.