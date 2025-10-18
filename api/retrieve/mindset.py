import os
import json
import psycopg
from typing import Any, Dict, List
from sentence_transformers import SentenceTransformer

MODEL_NAME = "sentence-transformers/all-MiniLM-L6-v2"
_database_url = os.environ.get("DATABASE_URL")
_model = None

def _get_model():
    global _model
    if _model is None:
        _model = SentenceTransformer(MODEL_NAME)
    return _model

def _to_vector_literal(vec):
    return "[" + ",".join(f"{float(v):.8f}" for v in vec) + "]"

def _json_response(status_code: int, body: Dict[str, Any]):
    return (status_code, {"Content-Type": "application/json"}, json.dumps(body))

def handler(request):
    if request["method"] != "POST":
        return _json_response(405, {"error": "Method Not Allowed"})

    if not _database_url:
        return _json_response(500, {"error": "DATABASE_URL not set"})

    try:
        body = json.loads(request.get("body") or "{}")
        query = body.get("query")
        filters = body.get("filters") or {}
        if not query:
            return _json_response(400, {"error": "Missing 'query' in body"})

        model = _get_model()
        q_emb = model.encode([query], normalize_embeddings=True)[0]
        emb_literal = _to_vector_literal(q_emb)

        where_clauses = []
        params: List[Any] = []
        if "module" in filters:
            where_clauses.append("(metadata->>'module') = %s")
            params.append(str(filters["module"]))
        if "lesson" in filters:
            where_clauses.append("(metadata->>'lesson') = %s")
            params.append(str(filters["lesson"]))

        where_sql = ("WHERE " + " AND ".join(where_clauses)) if where_clauses else ""
        sql = f"""
            SELECT content,
                   (1 - (embedding <=> {emb_literal}::vector)) AS similarity,
                   metadata,
                   source
            FROM kb_mindset
            {where_sql}
            ORDER BY embedding <-> {emb_literal}::vector
            LIMIT 5;
        """

        results = []
        with psycopg.connect(_database_url, autocommit=True) as conn:
            with conn.cursor() as cur:
                cur.execute(sql, params)
                for row in cur.fetchall():
                    content, similarity, metadata, source = row
                    m = metadata or {}
                    results.append({
                        "content": content,
                        "similarity": float(similarity),
                        "metadata": {
                            "module": m.get("module"),
                            "lesson": m.get("lesson"),
                            "timestamp": (m.get("timestamps") or [None])[0],
                            "speaker": (m.get("speakers") or [None])[0],
                            "source": source,
                        }
                    })

        return _json_response(200, {"results": results})

    except Exception as e:
        return _json_response(500, {"error": str(e)})