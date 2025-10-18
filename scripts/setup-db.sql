-- Enable pgvector extension (required for vector similarity search)
CREATE EXTENSION IF NOT EXISTS vector;

-- Optional: enable uuid-ossp if needed later
-- CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- Create tables for KBs
CREATE TABLE IF NOT EXISTS kb_course_transcripts (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(384) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_mindset (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(384) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS kb_calls (
  id BIGSERIAL PRIMARY KEY,
  content TEXT NOT NULL,
  embedding VECTOR(384) NOT NULL,
  metadata JSONB DEFAULT '{}'::jsonb,
  source TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- HNSW indexes for fast cosine similarity search
-- Requires pgvector >= 0.5.0 and Postgres >= 16 on Neon
-- Adjust parameters (m, ef_construction) if needed
DO $$
BEGIN
  -- kb_course_transcripts
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'kb_course_transcripts_embedding_hnsw_idx'
  ) THEN
    EXECUTE 'CREATE INDEX kb_course_transcripts_embedding_hnsw_idx ON kb_course_transcripts USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200)';
  END IF;

  -- kb_mindset
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'kb_mindset_embedding_hnsw_idx'
  ) THEN
    EXECUTE 'CREATE INDEX kb_mindset_embedding_hnsw_idx ON kb_mindset USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200)';
  END IF;

  -- kb_calls
  IF NOT EXISTS (
    SELECT 1
    FROM pg_indexes
    WHERE schemaname = 'public' AND indexname = 'kb_calls_embedding_hnsw_idx'
  ) THEN
    EXECUTE 'CREATE INDEX kb_calls_embedding_hnsw_idx ON kb_calls USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 200)';
  END IF;
END
$$;

-- Optional keyword search support via GIN on metadata for filtering
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'kb_course_transcripts_metadata_gin_idx'
  ) THEN
    EXECUTE 'CREATE INDEX kb_course_transcripts_metadata_gin_idx ON kb_course_transcripts USING GIN (metadata)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'kb_mindset_metadata_gin_idx'
  ) THEN
    EXECUTE 'CREATE INDEX kb_mindset_metadata_gin_idx ON kb_mindset USING GIN (metadata)';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'kb_calls_metadata_gin_idx'
  ) THEN
    EXECUTE 'CREATE INDEX kb_calls_metadata_gin_idx ON kb_calls USING GIN (metadata)';
  END IF;
END
$$;