#!/usr/bin/env python3
"""
Ingest content from /content into Neon Postgres with pgvector.
- Reads course transcripts, mindset transcripts & worksheets, and call transcripts.
- Parses headers and timestamps, chunks content (500–800 tokens, 100 overlap).
- Generates embeddings with sentence-transformers/all-MiniLM-L6-v2 (384-dim).
- Upserts into kb_course_transcripts, kb_mindset, kb_calls with idempotency via content hash.
"""

import os
import re
import json
import hashlib
from dataclasses import dataclass
from typing import List, Dict, Iterable, Tuple, Optional
import psycopg
from tqdm import tqdm

# Use CPU inference
from sentence_transformers import SentenceTransformer

DATABASE_URL = os.environ.get("DATABASE_URL")
EMBED_DIM = 384
MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"

# ---------------- Tokenization / Chunking ---------------- #

def simple_tokenize(text: str) -> List[str]:
    # Basic whitespace tokenization
    return re.findall(r"\S+", text)

def chunk_text(text: str, min_tokens: int = 500, max_tokens: int = 800, overlap: int = 100) -> List[str]:
    tokens = simple_tokenize(text)
    chunks = []
    start = 0
    while start < len(tokens):
        end = min(start + max_tokens, len(tokens))
        chunk_tokens = tokens[start:end]
        # If chunk is too small at end, include it anyway
        if len(chunk_tokens) < min_tokens and end < len(tokens):
            end = min(start + min_tokens, len(tokens))
            chunk_tokens = tokens[start:end]
        chunks.append(" ".join(chunk_tokens))
        if end >= len(tokens):
            break
        start = max(0, end - overlap)
    return chunks

# ---------------- Parsing Helpers ---------------- #

TIMESTAMP_RE = re.compile(r"(\\b\\d{1,2}:\\d{2}(?::\\d{2})?\\b)")
HEADER_RE = re.compile(r"^\\s*(Module|Lesson|Title)\\s*[:\\-]\\s*(.+)$", re.IGNORECASE)

def extract_metadata(path: str, text: str) -> Dict:
    """
    Extract metadata:
    - module, lesson from header lines
    - timestamps present
    - speaker labels (e.g., 'Speaker:', 'Agent:', 'Client:')
    - source file path
    """
    meta = {
        "module": None,
        "lesson": None,
        "timestamps": [],
        "speakers": [],
        "source": path,
    }

    lines = text.splitlines()
    for line in lines[:50]:  # look at first 50 lines for headers
        m = HEADER_RE.search(line)
        if m:
            key = m.group(1).lower()
            val = m.group(2).strip()
            if key == "module":
                meta["module"] = val
            elif key == "lesson" or key == "title":
                meta["lesson"] = val

    # Timestamps
    ts = TIMESTAMP_RE.findall(text)
    meta["timestamps"] = ts

    # Speakers
    speaker_re = re.compile(r"^(?:Speaker|Agent|Client|Coach|User|Host)\\s*[:\\-]\\s*(.+)$", re.IGNORECASE)
    speakers = []
    for line in lines:
        sm = speaker_re.search(line)
        if sm:
            name = sm.group(1).strip()
            if name not in speakers:
                speakers.append(name)
    meta["speakers"] = speakers

    return meta

def strip_timestamps(text: str) -> str:
    return TIMESTAMP_RE.sub("", text)

def content_hash(content: str, meta: Dict) -> str:
    h = hashlib.sha256()
    h.update(content.encode("utf-8"))
    h.update(json.dumps(meta, sort_keys=True).encode("utf-8"))
    return h.hexdigest()

# ---------------- DB Helpers ---------------- #

def ensure_db():
    if not DATABASE_URL:
        raise RuntimeError("DATABASE_URL environment variable is required")

def to_vector_literal(vec: List[float]) -> str:
    # pgvector literal format: '[0.1,0.2,...]'::vector
    return "[" + ",".join(f"{v:.8f}" for v in vec) + "]"

def upsert_rows(conn: psycopg.Connection, table: str, rows: List[Tuple[str, Dict, str]]) -> int:
    """
    rows: List of (content, metadata_json, embedding_literal)
    Idempotency by checking metadata->>'hash'
    """
    inserted = 0
    with conn.cursor() as cur:
        for content, metadata, emb_literal in rows:
            mh = metadata.get("hash")
            assert mh, "metadata.hash required"
            # Check existence
            cur.execute(f"SELECT id FROM {table} WHERE metadata->>'hash' = %s", (mh,))
            exists = cur.fetchone()
            if exists:
                continue
            cur.execute(
                f"""
                INSERT INTO {table} (content, embedding, metadata, source)
                VALUES (%s, %s::vector, %s::jsonb, %s)
                """,
                (content, emb_literal, json.dumps(metadata), metadata.get("source"))
            )
            inserted += 1
    return inserted

# ---------------- Main Ingestion ---------------- #

@dataclass
class KBSpec:
    glob_patterns: List[str]
    table: str

KB_SPECS = [
    KBSpec(glob_patterns=["content/course-transcripts/*.txt"], table="kb_course_transcripts"),
    KBSpec(glob_patterns=[
        "content/mindset/transcripts/*.txt",
        "content/mindset/worksheets/*.txt"
    ], table="kb_mindset"),
    KBSpec(glob_patterns=["content/calls/*.txt"], table="kb_calls"),
]

def iter_files(patterns: List[str]) -> Iterable[str]:
    import glob
    for pat in patterns:
        for path in glob.glob(pat):
            yield path

def read_text(path: str) -> str:
    with open(path, "r", encoding="utf-8", errors="ignore") as f:
        return f.read()

def main():
    ensure_db()
    print("Loading embedding model:", MODEL_NAME)
    model = SentenceTransformer(MODEL_NAME)

    with psycopg.connect(DATABASE_URL, autocommit=True) as conn:
        total_inserted = 0
        for spec in KB_SPECS:
            files = list(iter_files(spec.glob_patterns))
            if not files:
                print(f"[{spec.table}] No files matched.")
                continue
            print(f"[{spec.table}] Found {len(files)} files")
            rows: List[Tuple[str, Dict, str]] = []

            for path in tqdm(files, desc=f"Processing {spec.table}"):
                text = read_text(path)
                meta = extract_metadata(path, text)
                body = strip_timestamps(text)

                chunks = chunk_text(body)
                # Compute embeddings for chunks
                embeddings = model.encode(chunks, normalize_embeddings=True)
                for idx, chunk in enumerate(chunks):
                    chunk_meta = dict(meta)
                    chunk_meta["chunk_index"] = idx
                    chunk_meta["chunk_count"] = len(chunks)
                    chunk_meta["hash"] = content_hash(chunk, {
                        "module": chunk_meta.get("module"),
                        "lesson": chunk_meta.get("lesson"),
                        "source": chunk_meta.get("source"),
                        "chunk_index": idx
                    })
                    emb = embeddings[idx]
                    emb_literal = to_vector_literal(list(map(float, emb.tolist() if hasattr(emb, "tolist") else emb)))
                    rows.append((chunk, chunk_meta, emb_literal))

            inserted = upsert_rows(conn, spec.table, rows)
            total_inserted += inserted
            print(f"[{spec.table}] Inserted {inserted} new chunks")

        print(f"Total inserted: {total_inserted}")

if __name__ == "__main__":
    main()