# Content

This directory is the Knowledge Base (KB) for the advisor.

Subdirectories:
- course-transcripts/: Course training transcripts (text files).
- mindset/transcripts/: Mindset transcript files.
- mindset/worksheets/: Mindset worksheets (text files).
- calls/: Call transcripts (text files).

Notes:
- Ingestion script reads these files, parses headers and timestamps, chunks content, and writes embeddings into Neon pgvector tables.