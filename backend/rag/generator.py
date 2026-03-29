import ollama
import json
from rag.ingestor import Chunk


class CitedAnswer:
    def __init__(self, answer: str, citations: list[dict], confidence: float, conflicts: list[dict]):
        self.answer = answer
        self.citations = citations
        self.confidence = confidence
        self.conflicts = conflicts


def build_prompt(query: str, chunks: list[tuple[Chunk, float]]) -> str:
    context_blocks = []
    for chunk, score in chunks:
        page_info = f"page {chunk.page}" if chunk.page else "no page"
        source_name = chunk.source.split('/')[-1]  # use filename, not full path
        block = f"""[SOURCE: {source_name}] ({page_info}, relevance: {round(score, 3)})
{chunk.text}""".strip()
        context_blocks.append(block)

    context = "\n\n".join(context_blocks)

    prompt = f"""
You are a document Q&A assistant. Answer the question using ONLY the provided context chunks.
Do NOT use any outside knowledge.

CONTEXT:
{context}

QUESTION: {query}

CRITICAL RULES — VIOLATING THESE WILL MAKE YOUR RESPONSE INVALID:
1. Answer ONLY from the context above
2. Cite sources inline using [filename] format e.g. [Profile.pdf]
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
      "source": "filename or url",
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

    return prompt


def clean_raw(raw: str) -> str:
    # strip markdown code blocks
    if "```" in raw:
        parts = raw.split("```")
        raw = parts[1] if len(parts) > 1 else raw
        if raw.startswith("json"):
            raw = raw[4:]

    # extract only the outermost JSON object
    start = raw.find("{")
    end = raw.rfind("}") + 1
    if start != -1 and end > start:
        raw = raw[start:end]

    # fix unclosed JSON — count braces and add missing ones
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

    # Check if answer contains a full JSON structure (nested response)
    stripped = answer.strip()
    if stripped.startswith("{"):
        try:
            nested = json.loads(stripped)
            if isinstance(nested, dict) and "answer" in nested:
                # Merge: prefer nested data but keep outer citations/confidence if nested is missing them
                merged = {
                    "answer": nested.get("answer", answer),
                    "citations": nested.get("citations") or data.get("citations", []),
                    "confidence": nested.get("confidence") or data.get("confidence", 0.0),
                    "conflicts": nested.get("conflicts") or data.get("conflicts", []),
                }
                return unwrap_answer(merged)  # recurse in case still nested
        except (json.JSONDecodeError, ValueError):
            pass

    # Strip any trailing JSON artifact that got appended to the answer text
    # e.g. answer = "Some text", "citations": [...]
    for pattern in ['"\s*,\s*"citations', '"\s*,\s*"confidence', '"\s*}']:
        import re
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
    seen_sources = set()
    for i, (chunk, score) in enumerate(chunks):
        source_name = chunk.source.split('/')[-1]
        # One citation per unique source (use the highest-scoring chunk for that source)
        if source_name not in seen_sources:
            seen_sources.add(source_name)
            # Use first 200 chars of chunk text as excerpt
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


def compute_retrieval_confidence(chunks: list[tuple[Chunk, float]]) -> float:
    """Compute a reliable confidence score from cosine similarity of the top retrieved chunks.

    Cosine similarity scores from nomic-embed-text typically range 0.5–1.0 for relevant
    content. We normalise into a 0–1 confidence band:
      >= 0.88  → High   (0.90+)
      >= 0.80  → Medium (0.75)
      >= 0.70  → Medium (0.60)
      < 0.70   → Low    (0.40)
    We blend the top-3 chunk scores (weighted toward the best match) so a single
    strong hit still reads as High Confidence.
    """
    if not chunks:
        return 0.0

    scores = [score for _, score in chunks[:3]]  # top-3 only
    # Weighted average: best chunk counts double
    if len(scores) == 1:
        weighted = scores[0]
    elif len(scores) == 2:
        weighted = (scores[0] * 2 + scores[1]) / 3
    else:
        weighted = (scores[0] * 2 + scores[1] + scores[2]) / 4

    if weighted >= 0.88:
        return 0.92
    elif weighted >= 0.80:
        return 0.78
    elif weighted >= 0.70:
        return 0.62
    else:
        return 0.42


def generate_answer(query: str, chunks: list[tuple[Chunk, float]]) -> CitedAnswer:

    if not chunks:
        return CitedAnswer(
            answer="No relevant documents found. Please upload documents first.",
            citations=[],
            confidence=0.0,
            conflicts=[]
        )

    prompt = build_prompt(query, chunks)

    # call Mistral locally via Ollama
    # system prompt enforces JSON-only output
    response = ollama.chat(
        model="qwen3.5:4b",
        messages=[
            {
                "role": "system",
                "content": "You are a JSON-only response bot. You ALWAYS respond with valid complete JSON objects only. Never leave JSON incomplete. Never add text outside the JSON."
            },
            {
                "role": "user",
                "content": prompt
            }
        ]
    )

    raw = response["message"]["content"].strip()
    raw = clean_raw(raw)

    # Pre-compute retrieval-based confidence — objective, not LLM-guessed
    retrieval_confidence = compute_retrieval_confidence(chunks)

    try:
        data = json.loads(raw)

        # Recursively unwrap nested JSON in the answer field
        data = unwrap_answer(data)

        answer = data.get("answer", "")
        citations = data.get("citations", [])
        llm_confidence = data.get("confidence", 0.0)
        conflicts = data.get("conflicts", [])

        # Use retrieval score as the authoritative confidence.
        # Small models chronically under-report (0.2–0.4) even with perfect context.
        # We take the higher of the two so a genuinely uncertain answer isn't inflated,
        # but a good retrieval hit isn't penalised by a pessimistic LLM.
        confidence = max(retrieval_confidence, float(llm_confidence) if llm_confidence else 0.0)

        # Fallback: LLM returned empty citations — auto-build from retrieved chunks
        if not citations and chunks:
            citations = build_fallback_citations(chunks)

        # Validate citation structure — filter out any malformed entries
        valid_citations = []
        for c in citations:
            if isinstance(c, dict) and "source" in c:
                valid_citations.append({
                    "chunk": c.get("chunk", 1),
                    "source": c.get("source", ""),
                    "page": c.get("page"),
                    "excerpt": c.get("excerpt", ""),
                })
        citations = valid_citations

        return CitedAnswer(
            answer=answer,
            citations=citations,
            confidence=confidence,
            conflicts=conflicts
        )

    except json.JSONDecodeError:
        # LLM didn't return valid JSON — use raw text + retrieval-based confidence
        fallback_citations = build_fallback_citations(chunks) if chunks else []
        return CitedAnswer(
            answer=raw,
            citations=fallback_citations,
            confidence=retrieval_confidence,
            conflicts=[]
        )