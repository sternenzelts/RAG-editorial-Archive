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
        model="ministral-3:3b",
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

    try:
        data = json.loads(raw)

        answer = data.get("answer", "")
        citations = data.get("citations", [])
        confidence = data.get("confidence", 0.0)
        conflicts = data.get("conflicts", [])

        # if answer itself contains a nested JSON string, extract it
        if isinstance(answer, str) and answer.strip().startswith("{"):
            try:
                nested = json.loads(answer)
                answer = nested.get("answer", answer)
                if not citations:
                    citations = nested.get("citations", [])
                if not confidence:
                    confidence = nested.get("confidence", 0.0)
                if not conflicts:
                    conflicts = nested.get("conflicts", [])
            except json.JSONDecodeError:
                pass

        return CitedAnswer(
            answer=answer,
            citations=citations,
            confidence=confidence,
            conflicts=conflicts
        )

    except json.JSONDecodeError:
        # if Mistral didn't follow the format, return raw text with low confidence
        return CitedAnswer(
            answer=raw,
            citations=[],
            confidence=0.1,
            conflicts=[]
        )