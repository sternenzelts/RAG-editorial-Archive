import ollama
import json
import re
from rag.ingestor import Chunk


class CitedAnswer:
    def __init__(self, answer: str, citations: list[dict], confidence: float, conflicts: list[dict]):
        self.answer = answer
        self.citations = citations
        self.confidence = confidence
        self.conflicts = conflicts


# ── Prompt builders ────────────────────────────────────────────────────────────

def build_prompt(query: str, chunks: list[tuple[Chunk, float]]) -> str:
    """Prompt for the non-streaming /query endpoint (JSON-only output)."""
    context_blocks = []
    for chunk, score in chunks:
        page_info = f"page {chunk.page}" if chunk.page else "no page"
        source_name = chunk.source.split('/')[-1]
        block = f"[SOURCE: {source_name}] ({page_info}, relevance: {round(score, 3)})\n{chunk.text}".strip()
        context_blocks.append(block)

    context = "\n\n".join(context_blocks)

    return f"""
You are a document Q&A assistant. Answer the question using ONLY the provided context chunks.
Do NOT use any outside knowledge.

CONTEXT:
{context}

QUESTION: {query}

CRITICAL RULES — VIOLATING THESE WILL MAKE YOUR RESPONSE INVALID:
1. Answer ONLY from the context above
2. Cite sources inline using [filename, p.X] format — e.g. [business plan.pdf, p.3]. Use the page number shown in the SOURCE header above the chunk. If no page is given, use [filename].
3. DO NOT add a Citations section inside the answer text
4. DO NOT add a Confidence section inside the answer text
5. DO NOT add any extra text after your answer closes
6. Put confidence score ONLY in the JSON confidence field — never inside answer text
7. Return ONLY valid JSON — no text before or after the JSON object
8. The answer field must be plain text with inline [filename] citations only — no JSON inside answer
9. ALWAYS close all JSON braces and brackets — never return incomplete JSON

REQUIRED JSON FORMAT:
{{
  "answer": "your clean answer here with [filename.pdf] inline citations only",
  "citations": [
    {{
      "chunk": 1,
      "source": "actual_source_filename.pdf",
      "page": 3,
      "excerpt": "exact snippet from that chunk"
    }}
  ],
  "confidence": 0.85,
  "conflicts": [
    {{
      "chunk_a": 1,
      "chunk_b": 3,
      "description": "chunk 1 says X but chunk 3 says Y"
    }}
  ]
}}

If no conflicts exist return empty array for conflicts.
RETURN ONLY THE JSON OBJECT. NOTHING ELSE. NO TRAILING TEXT.
""".strip()


def build_streaming_prompt(query: str, chunks: list[tuple[Chunk, float]]) -> str:
    """
    Prompt for the streaming /query/stream endpoint.
    Model writes a markdown answer, then emits <<<METADATA>>> followed by
    a single-line JSON object with citations and conflicts.
    """
    context_blocks = []
    for chunk, score in chunks:
        page_info = f"page {chunk.page}" if chunk.page else "no page"
        source_name = chunk.source.split('/')[-1]
        context_blocks.append(
            f"[SOURCE: {source_name}] ({page_info}, relevance: {round(score, 3)})\n{chunk.text}"
        )
    context = "\n\n".join(context_blocks)

    return f"""You are a document Q&A assistant. Answer using ONLY the context below.

CONTEXT:
{context}

QUESTION: {query}

INSTRUCTIONS:
1. Write a clear, well-structured markdown answer citing sources inline as [filename].
2. After the answer, output EXACTLY this sentinel line (nothing else on it):
   <<<METADATA>>>
3. Then output a JSON object on a single line:
   {{"citations":[{{"chunk":1,"source":"file","page":3,"excerpt":"text"}}],"conflicts":[]}}

Rules:
- Cite inline as [filename, p.X] using the page number from the SOURCE header (e.g. [business plan.pdf, p.4]). If no page is listed, use [filename].
- Do NOT write a "Citations:" section in the answer body
- Keep the answer and the JSON strictly separated by <<<METADATA>>>
""".strip()


# ── Helpers ────────────────────────────────────────────────────────────────────

def clean_raw(raw: str) -> str:
    """Strip markdown fences and extract the outermost JSON object."""
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]

    start = raw.find("{")
    end = raw.rfind("}") + 1
    if start != -1 and end > start:
        raw = raw[start:end]

    # fix unclosed braces
    open_braces = raw.count("{")
    close_braces = raw.count("}")
    if open_braces > close_braces:
        raw += "}" * (open_braces - close_braces)

    # fix unclosed strings
    if raw.count('"') % 2 != 0:
        raw += '"'

    return raw.strip()


def unwrap_answer(data: dict) -> dict:
    """Recursively unwrap if the answer field itself is a JSON string containing the full response."""
    answer = data.get("answer", "")
    if not isinstance(answer, str):
        return data

    stripped = answer.strip()
    if stripped.startswith("{"):
        try:
            nested = json.loads(stripped)
            if isinstance(nested, dict) and "answer" in nested:
                merged = {
                    "answer": nested.get("answer", answer),
                    "citations": nested.get("citations") or data.get("citations", []),
                    "confidence": nested.get("confidence") or data.get("confidence", 0.0),
                    "conflicts": nested.get("conflicts") or data.get("conflicts", []),
                }
                return unwrap_answer(merged)
        except (json.JSONDecodeError, ValueError):
            pass

    for pattern in [r'"\s*,\s*"citations', r'"\s*,\s*"confidence', r'"\s*}']:
        match = re.search(pattern, answer)
        if match:
            answer = answer[:match.start()].strip().strip('"')
            data = dict(data)
            data["answer"] = answer
            break

    return data


def build_fallback_citations(chunks: list[tuple[Chunk, float]]) -> list[dict]:
    """Build citations directly from retrieved chunks when the LLM returns none."""
    citations = []
    seen_sources: set[str] = set()
    for i, (chunk, _score) in enumerate(chunks):
        source_name = chunk.source.split('/')[-1]
        if source_name not in seen_sources:
            seen_sources.add(source_name)
            excerpt = chunk.text[:200].strip()
            if len(chunk.text) > 200:
                excerpt += "..."
            citations.append({
                "chunk": i + 1,
                "source": source_name,
                "page": chunk.page,
                "excerpt": excerpt,
            })
    return citations


def _validate_citations(raw_citations: list, chunks: list[tuple[Chunk, float]] | None = None) -> list[dict]:
    """Validate and fix citation objects. Replace placeholder source names with real ones."""
    # Build a lookup of real source names from chunks
    real_sources: list[str] = []
    if chunks:
        for c, _ in chunks:
            name = c.source.split('/')[-1]
            if name not in real_sources:
                real_sources.append(name)

    placeholder_names = {'file', 'source', 'document', 'filename', 'filename or url', 'url', ''}

    valid = []
    for c in raw_citations:
        if isinstance(c, dict) and "source" in c:
            src = c.get("source", "")
            # If the model put a placeholder, replace with the real source
            if src.lower().strip() in placeholder_names and real_sources:
                # Try to match by chunk number
                chunk_idx = c.get("chunk", 1) - 1
                if 0 <= chunk_idx < len(real_sources):
                    src = real_sources[chunk_idx]
                else:
                    src = real_sources[0]
            valid.append({
                "chunk": c.get("chunk", 1),
                "source": src,
                "page": c.get("page"),
                "excerpt": c.get("excerpt", ""),
            })
    return valid


def compute_retrieval_confidence(chunks: list[tuple[Chunk, float]]) -> float:
    """
    Compute confidence from retrieval cosine similarity + source coverage.

    nomic-embed-text cosine similarity real-world ranges:
      Specific factual query  → top chunk 0.80–0.92
      Broad / summary query   → top chunk 0.55–0.72  (many chunks match weakly)
      Unrelated query         → top chunk < 0.50

    We weight the top-3 scores and add a small bonus when multiple chunks
    from the same document contributed (indicating broad coverage).
    """
    if not chunks:
        return 0.0

    scores = [score for _, score in chunks[:3]]
    if len(scores) == 1:
        weighted = scores[0]
    elif len(scores) == 2:
        weighted = (scores[0] * 2 + scores[1]) / 3
    else:
        weighted = (scores[0] * 2 + scores[1] + scores[2]) / 4

    # Coverage bonus: reward answers backed by many chunks (summary answers)
    # Each extra chunk beyond the first adds a small boost, capped at +0.06
    coverage_bonus = min(0.06, (len(chunks) - 1) * 0.015)
    effective = weighted + coverage_bonus

    if effective >= 0.75:
        return 0.92   # High
    elif effective >= 0.62:
        return 0.78   # Medium-High
    elif effective >= 0.52:
        return 0.62   # Medium
    else:
        return 0.42   # Low



# ── Non-streaming answer ───────────────────────────────────────────────────────

def generate_answer(query: str, chunks: list[tuple[Chunk, float]]) -> CitedAnswer:

    if not chunks:
        return CitedAnswer(
            answer="No relevant documents found. Please upload documents first.",
            citations=[],
            confidence=0.0,
            conflicts=[]
        )

    prompt = build_prompt(query, chunks)
    retrieval_confidence = compute_retrieval_confidence(chunks)

    response = ollama.chat(
        model="ministral-3:3b",
        messages=[
            {
                "role": "system",
                "content": "You are a JSON-only response bot. You ALWAYS respond with valid complete JSON objects only. Never leave JSON incomplete. Never add text outside the JSON."
            },
            {"role": "user", "content": prompt}
        ]
    )

    raw = clean_raw(response["message"]["content"].strip())

    try:
        data = unwrap_answer(json.loads(raw))

        answer = data.get("answer", "")
        citations = _validate_citations(data.get("citations", []), chunks)
        llm_confidence = data.get("confidence", 0.0)
        conflicts = data.get("conflicts", [])
        confidence = max(retrieval_confidence, float(llm_confidence) if llm_confidence else 0.0)

        if not citations:
            citations = build_fallback_citations(chunks)

        return CitedAnswer(answer=answer, citations=citations, confidence=confidence, conflicts=conflicts)

    except json.JSONDecodeError:
        return CitedAnswer(
            answer=raw,
            citations=build_fallback_citations(chunks),
            confidence=retrieval_confidence,
            conflicts=[]
        )


# ── Streaming answer ───────────────────────────────────────────────────────────

def stream_answer(query: str, chunks: list[tuple[Chunk, float]]):
    """
    Generator that streams LLM tokens then yields a final metadata event.

    Yield protocol (consumed by the SSE route in main.py):
      ("token", token_text)   — streamed to the frontend incrementally
      ("done",  json_string)  — final event with citations/confidence/conflicts
      ("error", message)      — on any exception
    """
    if not chunks:
        yield ("done", json.dumps({
            "answer": "No relevant documents found. Please upload documents first.",
            "citations": [], "confidence": 0.0, "conflicts": [],
        }))
        return

    retrieval_confidence = compute_retrieval_confidence(chunks)
    prompt = build_streaming_prompt(query, chunks)
    full_text = ""
    answer_done = False

    try:
        stream = ollama.chat(
            model="ministral-3:3b",
            messages=[
                {
                    "role": "system",
                    "content": (
                        "You are a helpful document assistant. "
                        "Follow the user's formatting instructions exactly, "
                        "including the <<<METADATA>>> sentinel and the JSON line after it."
                    ),
                },
                {"role": "user", "content": prompt},
            ],
            stream=True,
        )

        for chunk_resp in stream:
            token: str = chunk_resp["message"]["content"]
            full_text += token

            if "<<<METADATA>>>" in full_text and not answer_done:
                answer_done = True
                # Signal frontend: stop typewriter, citations incoming
                yield ("token", "\x00")  # null byte sentinel
                continue

            if not answer_done:
                yield ("token", token)

    except Exception as e:
        yield ("error", str(e))
        return

    # ── Parse answer + metadata ────────────────────────────────────────────────
    if "<<<METADATA>>>" in full_text:
        answer_text, meta_text = full_text.split("<<<METADATA>>>", 1)
        answer_text = answer_text.strip()
        meta_text = meta_text.strip()
    else:
        answer_text = full_text.strip()
        meta_text = ""

    citations: list[dict] = []
    conflicts: list[dict] = []

    if meta_text:
        j_start = meta_text.find("{")
        j_end = meta_text.rfind("}") + 1
        if j_start != -1 and j_end > j_start:
            try:
                meta = json.loads(meta_text[j_start:j_end])
                citations = meta.get("citations", [])
                conflicts = meta.get("conflicts", [])
            except json.JSONDecodeError:
                pass

    if not citations:
        citations = build_fallback_citations(chunks)

    yield ("done", json.dumps({
        "answer": answer_text,
        "citations": _validate_citations(citations, chunks),
        "confidence": retrieval_confidence,
        "conflicts": conflicts,
    }))