from fastapi import FastAPI, UploadFile, File, Form, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse
from pydantic import BaseModel
from collections import defaultdict
from rag.ingestor import ingest_pdf, ingest_url, ingest_text
from rag.retriever import vector_store
from rag.generator import generate_answer
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
    from dataclasses import asdict
    return {"collections": [asdict(c) for c in workspace_store.collections]}


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
2. The summary field must be plain prose with inline [filename] citations referring to the SOURCE NAME (e.g. [report.pdf])
3. NEVER write "chunk 1", "chunk 2", "passage", or any numbered references — ONLY use the actual source filename in square brackets
4. The insight field must be a single synthetic observation connecting themes across the sources
5. Identify any key numeric metric mentioned in the documents
6. ALWAYS close all JSON braces

RETURN THIS EXACT JSON FORMAT:
{{
  "title": "Executive Summary: {col.name}",
  "summary": "3-4 sentence executive summary with inline [source_filename] citations only",
  "insight": "One key synthetic insight connecting patterns across the documents",
  "metric_label": "key metric name or empty string",
  "metric_value": "key metric value or empty string",
  "metric_delta": "change indicator like +8% or empty string",
  "confidence": 0.85,
  "cross_references": 5
}}""".strip()

    response = ollama.chat(
        model="qwen3.5:4b",
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

    # Post-process: replace any residual "chunk N" / "passage N" refs with
    # the first source name so the UI never shows raw chunk numbers
    first_source = source_names[0] if source_names else "document"
    def clean_chunk_refs(text: str) -> str:
        # Replace patterns like "chunk 1", "Chunk 2", "passage 3", "section 1" with [source]
        return re.sub(
            r'\b(?:chunk|passage|section|excerpt)\s*\d+\b',
            f'[{first_source}]',
            text,
            flags=re.IGNORECASE
        )
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