from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from pydantic import BaseModel
from collections import defaultdict
from rag.ingestor import ingest_pdf, ingest_url, ingest_text
from rag.retriever import vector_store
from rag.generator import generate_answer, stream_answer
from workspace_store import workspace_store
import ollama
import os

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
UPLOADS_DIR = os.path.join(BASE_DIR, "uploads")
os.makedirs(UPLOADS_DIR, exist_ok=True)

app = FastAPI(title="RAG Q&A API")


# CORS allows your React frontend (localhost:5173) to talk to this backend (localhost:8000)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)


# ── Request / Response Models ──────────────────────────────────────────────────

class QueryRequest(BaseModel):
    question: str

class CitationResponse(BaseModel):
    chunk: int
    source: str
    page: int | None
    excerpt: str

class ConflictResponse(BaseModel):
    chunk_a: int
    chunk_b: int
    description: str

class QueryResponse(BaseModel):
    answer: str
    citations: list[CitationResponse]
    confidence: float
    conflicts: list[ConflictResponse]


# ── Routes ─────────────────────────────────────────────────────────────────────

# Health check
@app.get("/health")
def health():
    return {"status": "ok"}


# Upload a PDF file
@app.post("/ingest/pdf")
async def ingest_pdf_route(file: UploadFile = File(...)):
    if not file.filename.endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are supported")

    # Sanitize: strip any directory components (e.g. C:\path\file.pdf → file.pdf)
    safe_name = os.path.basename(file.filename)
    file_bytes = await file.read()

    # Save original file to disk so it can be opened later
    save_path = os.path.join(UPLOADS_DIR, safe_name)
    with open(save_path, "wb") as f:
        f.write(file_bytes)

    chunks = ingest_pdf(file_bytes, safe_name)
    vector_store.add_chunks(chunks)

    return {
        "message": f"Successfully ingested {safe_name}",
        "chunks_added": len(chunks),
        "filename": safe_name
    }


# Serve an uploaded PDF file — open in browser, not download
@app.get("/files/{filename}")
def serve_file(filename: str):
    safe_name = os.path.basename(filename)
    path = os.path.join(UPLOADS_DIR, safe_name)
    if not os.path.exists(path):
        raise HTTPException(status_code=404, detail=f"File not found: {safe_name}")
    return FileResponse(
        path,
        media_type="application/pdf",
        headers={"Content-Disposition": f"inline; filename=\"{safe_name}\""}
    )


# Ingest a URL
@app.post("/ingest/url")
async def ingest_url_route(url: str = Form(...)):
    try:
        chunks = ingest_url(url)
        vector_store.add_chunks(chunks)
        return {
            "message": f"Successfully ingested {url}",
            "chunks_added": len(chunks)
        }
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to fetch URL: {str(e)}")


# Ingest plain text
@app.post("/ingest/text")
async def ingest_text_route(text: str = Form(...), source: str = Form(default="pasted text")):
    chunks = ingest_text(text, source)
    vector_store.add_chunks(chunks)

    return {
        "message": f"Successfully ingested text from '{source}'",
        "chunks_added": len(chunks)
    }


# Ask a question
@app.post("/query", response_model=QueryResponse)
async def query_route(request: QueryRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    chunks = vector_store.search(request.question, top_k=5)
    result = generate_answer(request.question, chunks)

    return QueryResponse(
        answer=result.answer,
        citations=[CitationResponse(**c) for c in result.citations],
        confidence=result.confidence,
        conflicts=[ConflictResponse(**c) for c in result.conflicts]
    )



# Stream a question answer — token by token SSE
@app.post("/query/stream")
async def query_stream_route(request: QueryRequest):
    if not request.question.strip():
        raise HTTPException(status_code=400, detail="Question cannot be empty")

    chunks = vector_store.search(request.question, top_k=5)

    def event_generator():
        for event_type, payload in stream_answer(request.question, chunks):
            if event_type == "token":
                # Null-byte sentinel means citations are coming — send a special event
                if payload == "\x00":
                    yield "event: end_tokens\ndata: {}\n\n"
                else:
                    # Escape newlines so the SSE protocol isn't broken
                    safe = payload.replace("\n", "\\n")
                    yield f"data: {safe}\n\n"
            elif event_type == "done":
                yield f"event: done\ndata: {payload}\n\n"
            elif event_type == "error":
                import json as _json
                yield f"event: error\ndata: {_json.dumps({'detail': payload})}\n\n"

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
        },
    )


# Suggest questions based on ingested chunks for a source
@app.get("/suggest")
def suggest_route(source: str = ""):
    """
    Return up to 3 heuristic question suggestions for the most recently added
    source (or a specific source if provided). No LLM call — purely derived
    from chunk text to ensure zero added latency.
    """
    import re as _re

    # Pick chunks for the requested source, or fall back to all chunks
    if source:
        candidates = [c for c in vector_store.chunks if c.source == source]
    else:
        candidates = vector_store.chunks

    if not candidates:
        return {"suggestions": []}

    # Use first 3 distinct-source chunks as seed text
    seen: set[str] = set()
    seed_chunks = []
    for c in candidates:
        src = c.source.split('/')[-1]
        if src not in seen:
            seen.add(src)
            seed_chunks.append(c)
        if len(seed_chunks) == 3:
            break

    suggestions = []

    for c in seed_chunks:
        src_name = c.source.split('/')[-1]
        text = c.text[:600]  # first ~600 chars of chunk

        # Heuristic 1: topic question from first sentence
        first_sentence = _re.split(r'(?<=[.!?])\s', text)[0][:120].strip()
        if len(first_sentence) > 30:
            suggestions.append(f"What does {src_name} say about: \"{first_sentence[:80]}...\"?")
        else:
            suggestions.append(f"What is the main topic discussed in {src_name}?")

        # Heuristic 2: numeric/metric question
        numbers = _re.findall(r'\b\d[\d,\.]*\s*(?:%|percent|million|billion|thousand|k\b)?', text)
        if numbers:
            suggestions.append(f"What figures or metrics are mentioned in {src_name}?")
        else:
            suggestions.append(f"What key claims are made in {src_name}?")

    # Deduplicate and cap at 3
    seen_q: set[str] = set()
    final: list[str] = []
    for q in suggestions:
        if q not in seen_q:
            seen_q.add(q)
            final.append(q)
        if len(final) == 3:
            break

    return {"suggestions": final}


# Clear all documents
@app.delete("/clear")
def clear_route():
    vector_store.clear()

    # Also wipe all uploaded files from disk
    deleted_files = 0
    if os.path.exists(UPLOADS_DIR):
        for fname in os.listdir(UPLOADS_DIR):
            fpath = os.path.join(UPLOADS_DIR, fname)
            if os.path.isfile(fpath):
                os.remove(fpath)
                deleted_files += 1

    return {"message": f"Vector store cleared and {deleted_files} file(s) deleted"}


# Delete a single source (all its chunks + uploaded file)
@app.delete("/ingest/source")
def delete_source_route(source: str):
    removed = vector_store.delete_source(source)
    if removed == 0:
        raise HTTPException(status_code=404, detail=f"No chunks found for source: {source}")

    # Also delete the uploaded file from disk if it exists
    file_path = os.path.join(UPLOADS_DIR, os.path.basename(source))
    if os.path.exists(file_path):
        os.remove(file_path)

    return {"message": f"Deleted {removed} chunks for '{source}'", "chunks_removed": removed}


# Status — returns detailed document info for Archive page
@app.get("/status")
def status_route():
    source_stats = defaultdict(lambda: {"chunks": 0, "type": "pdf", "pages": set()})

    for chunk in vector_store.chunks:
        source = chunk.source
        source_stats[source]["chunks"] += 1
        if chunk.page:
            source_stats[source]["pages"].add(chunk.page)
        # detect source type
        if chunk.source.startswith("http"):
            source_stats[source]["type"] = "url"
        elif chunk.source == "pasted text" or not chunk.source.endswith(".pdf"):
            source_stats[source]["type"] = "text"
        else:
            source_stats[source]["type"] = "pdf"

    documents = [
        {
            "source": source,
            "chunks": stats["chunks"],
            "pages": len(stats["pages"]),
            "type": stats["type"],
        }
        for source, stats in source_stats.items()
    ]

    return {
        "chunks_stored": len(vector_store.chunks),
        "sources": list(source_stats.keys()),
        "documents": documents
    }


# ── Workspace Routes ───────────────────────────────────────────────────────────

class CreateCollectionRequest(BaseModel):
    name: str
    description: str = ""

class AddSourceRequest(BaseModel):
    source: str

class UpdateSynthesisRequest(BaseModel):
    synthesis: str

class UpdateStatusRequest(BaseModel):
    status: str


@app.get("/workspace/collections")
def list_collections():
    import json as _json
    from dataclasses import asdict

    def try_unwrap(s: dict) -> dict:
        """If 'summary' contains nested JSON (the model's real output), extract it."""
        summary = s.get("summary", "")
        if isinstance(summary, str) and "{" in summary:
            cleaned = summary.replace("\n", " ").replace("\r", " ")
            start = cleaned.find("{")
            end = cleaned.rfind("}") + 1
            if start != -1 and end > start:
                try:
                    nested = _json.loads(cleaned[start:end])
                    if isinstance(nested, dict) and "summary" in nested:
                        return nested
                except (ValueError, _json.JSONDecodeError):
                    pass
        return s

    result = []
    for c in workspace_store.collections:
        d = asdict(c)
        if d.get("synthesis"):
            try:
                s = _json.loads(d["synthesis"])
                # Unwrap nested JSON-in-summary
                s = try_unwrap(s)
                # Normalize cross_references: array → count
                if isinstance(s.get("cross_references"), list):
                    s["cross_references"] = len(s["cross_references"])
                # Normalize confidence
                try:
                    s["confidence"] = max(0.0, min(1.0, float(s.get("confidence", 0.5))))
                except (TypeError, ValueError):
                    s["confidence"] = 0.5
                d["synthesis"] = s
            except Exception:
                d["synthesis"] = None
        result.append(d)
    return {"collections": result}


@app.post("/workspace/collections")
def create_collection(req: CreateCollectionRequest):
    from dataclasses import asdict
    col = workspace_store.create_collection(req.name, req.description)
    return asdict(col)


@app.delete("/workspace/collections/{collection_id}")
def delete_collection(collection_id: str):
    ok = workspace_store.delete_collection(collection_id)
    if not ok:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"message": "Collection deleted"}


@app.post("/workspace/collections/{collection_id}/documents")
def add_document(collection_id: str, req: AddSourceRequest):
    ok = workspace_store.add_source(collection_id, req.source)
    if not ok:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"message": f"Added {req.source}"}


@app.delete("/workspace/collections/{collection_id}/documents")
def remove_document(collection_id: str, req: AddSourceRequest):
    ok = workspace_store.remove_source(collection_id, req.source)
    if not ok:
        raise HTTPException(status_code=404, detail="Collection not found")
    return {"message": f"Removed {req.source}"}


@app.post("/workspace/collections/{collection_id}/synthesize")
def synthesize_collection(collection_id: str):
    from dataclasses import asdict
    col = workspace_store.get_collection(collection_id)
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
    if not col.sources:
        raise HTTPException(status_code=400, detail="Collection has no documents")

    # gather all chunks belonging to this collection's sources
    relevant_chunks = [
        (chunk, 1.0)
        for chunk in vector_store.chunks
        if chunk.source in col.sources
    ]
    if not relevant_chunks:
        raise HTTPException(
            status_code=400,
            detail="No ingested chunks found for the selected documents. Please ingest them first."
        )

    # build synthesis prompt — label sections by source name, not chunk number
    # so the LLM never learns to count chunks
    context_blocks = []
    for chunk, _ in relevant_chunks[:20]:  # cap at 20 chunks
        source_name = chunk.source.split('/')[-1]  # use filename not full path
        page_info = f"page {chunk.page}" if chunk.page else "no page"
        context_blocks.append(
            f"[SOURCE: {source_name}] ({page_info}):\n{chunk.text}"
        )
    context = "\n\n".join(context_blocks)

    source_names = [s.split('/')[-1] for s in col.sources]
    source_list = ', '.join(f'[{s}]' for s in source_names)

    prompt = f"""You are an editorial intelligence assistant. Synthesize the following document excerpts into a professional executive summary.

DOCUMENTS IN COLLECTION: {source_list}

DOCUMENT EXCERPTS:
{context}

CRITICAL RULES:
1. Return ONLY valid JSON — no text before or after
2. Embed citations INSIDE sentences, immediately after the claim they support — e.g. "Revenue is projected at ₱6.2M [business plan.pdf, p.5], driven by unit sales and subscriptions."
3. NEVER place a source name at the END of the summary as a standalone tag — citations must appear mid-sentence
4. NEVER write "chunk 1", "chunk 2", "passage", or any numbered references — ONLY use the actual source filename with page (e.g. [business plan.pdf, p.3])
5. The insight field must be a single synthetic observation connecting themes across the sources
6. Identify any key numeric metric mentioned in the documents
7. ALWAYS close all JSON braces

RETURN THIS EXACT JSON FORMAT:
{{
  "title": "Executive Summary: {col.name}",
  "summary": "3-4 sentence prose with inline [filename, p.X] citations embedded mid-sentence after each claim",
  "insight": "One key synthetic insight connecting patterns across the documents",
  "metric_label": "key metric name or empty string",
  "metric_value": "key metric value or empty string",
  "metric_delta": "change indicator like +8% or empty string",
  "confidence": 0.85,
  "cross_references": 5
}}""".strip()

    response = ollama.chat(
        model="ministral-3:3b",
        messages=[
            {
                "role": "system",
                "content": "You are a JSON-only response bot. Always return valid complete JSON."
            },
            {"role": "user", "content": prompt}
        ]
    )

    raw = response["message"]["content"].strip()

    # clean markdown fences
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]
    start = raw.find("{")
    end = raw.rfind("}") + 1
    if start != -1 and end > start:
        raw = raw[start:end]

    import json, re
    try:
        data = json.loads(raw)
    except Exception:
        data = {
            "title": f"Executive Summary: {col.name}",
            "summary": raw,
            "insight": "",
            "metric_label": "",
            "metric_value": "",
            "metric_delta": "",
            "confidence": 0.5,
            "cross_references": len(relevant_chunks)
        }

    # ── Unwrap nested JSON ─────────────────────────────────────────────────────
    # ministral-3:3b consistently puts the entire JSON response as a string
    # inside the "summary" field.  The nested string contains literal newlines
    # which are invalid JSON, so we must clean them before parsing.
    def try_parse_nested(text: str) -> dict | None:
        """Try to extract a valid synthesis dict from a string that may contain JSON."""
        if not isinstance(text, str):
            return None
        text = text.strip()
        if not text.startswith("{"):
            # Find the first { in the text
            idx = text.find("{")
            if idx == -1:
                return None
            text = text[idx:]

        # Trim to last }
        end = text.rfind("}")
        if end == -1:
            return None
        text = text[:end + 1]

        # Replace literal newlines with spaces (safe for both JSON structure
        # and string values)
        cleaned = text.replace("\n", " ").replace("\r", " ")

        try:
            obj = json.loads(cleaned)
            if isinstance(obj, dict) and "summary" in obj:
                return obj
        except (json.JSONDecodeError, ValueError):
            pass
        return None

    # Check if summary field contains the real nested response
    summary_val = data.get("summary", "")
    nested = try_parse_nested(summary_val)
    if nested is not None:
        data = nested

    # ── Normalise schema so the UI never breaks ────────────────────────────────
    # cross_references: model sometimes returns a list of citation strings
    xr = data.get("cross_references", len(relevant_chunks))
    if isinstance(xr, list):
        data["cross_references"] = len(xr)
    elif not isinstance(xr, (int, float)):
        data["cross_references"] = len(relevant_chunks)
    else:
        data["cross_references"] = int(xr)

    # String fields — coerce anything unexpected to str
    for field in ("title", "summary", "insight", "metric_label", "metric_value", "metric_delta"):
        if not isinstance(data.get(field), str):
            data[field] = str(data.get(field, ""))

    # Ensure title is not empty
    if not data["title"].strip():
        data["title"] = f"Executive Summary: {col.name}"

    # confidence must be a float 0–1
    try:
        data["confidence"] = max(0.0, min(1.0, float(data.get("confidence", 0.5))))
    except (TypeError, ValueError):
        data["confidence"] = 0.5

    # Post-process: replace any residual "chunk N" / "passage N" refs with
    # the first source name so the UI never shows raw chunk numbers
    first_source = source_names[0] if source_names else "document"
    def clean_chunk_refs(text: str) -> str:
        # Replace patterns like "chunk 1", "Chunk 2", "passage 3", "section 1" with [source]
        cleaned = re.sub(
            r'\b(?:chunk|passage|section|excerpt)\s*\d+\b',
            f'[{first_source}]',
            text,
            flags=re.IGNORECASE
        )
        # Strip any trailing standalone [filename] or (filename) at the very end of the string
        # e.g. "...key insight. [business plan.pdf]" → "...key insight."
        cleaned = re.sub(
            r'\s*[\[\(][^\]\)]*\.pdf[^\]\)]*[\]\)]\s*$',
            '',
            cleaned,
            flags=re.IGNORECASE
        ).strip()
        return cleaned
    if isinstance(data.get("summary"), str):
        data["summary"] = clean_chunk_refs(data["summary"])
    if isinstance(data.get("insight"), str):
        data["insight"] = clean_chunk_refs(data["insight"])

    workspace_store.set_synthesis(collection_id, json.dumps(data))
    return {"synthesis": data, "collection": asdict(col)}


@app.patch("/workspace/collections/{collection_id}/synthesis")
def update_synthesis(collection_id: str, req: UpdateSynthesisRequest):
    col = workspace_store.get_collection(collection_id)
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
    workspace_store.set_synthesis(collection_id, req.synthesis)
    return {"message": "Synthesis updated"}


@app.patch("/workspace/collections/{collection_id}/status")
def update_status(collection_id: str, req: UpdateStatusRequest):
    col = workspace_store.get_collection(collection_id)
    if not col:
        raise HTTPException(status_code=404, detail="Collection not found")
    workspace_store.set_status(collection_id, req.status)
    return {"message": f"Status set to {req.status}"}