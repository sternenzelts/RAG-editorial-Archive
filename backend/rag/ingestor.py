import httpx
from bs4 import BeautifulSoup
from pypdf import PdfReader
from dataclasses import dataclass
import io
import re

@dataclass
class Chunk:
    text: str
    source: str
    page: int | None
    chunk_index: int


def _split_sentences(text: str) -> list[str]:
    """Split text into sentences on .!? boundaries, preserving structure."""
    # Split after . ! ? followed by whitespace and an uppercase letter (or end of string)
    parts = re.split(r'(?<=[.!?])\s+(?=[A-Z\"\'\(])', text)
    # Further split on newlines so paragraph breaks also act as boundaries
    sentences: list[str] = []
    for part in parts:
        sub = re.split(r'\n\s*\n+', part.strip())
        sentences.extend(s.strip() for s in sub if s.strip())
    return sentences


def sentence_aware_chunk(
    text: str,
    source: str,
    page: int | None,
    target_words: int = 500,
    overlap_sentences: int = 2,
) -> list[Chunk]:
    """
    Sentence-boundary-aware chunker.

    Accumulates sentences until the chunk reaches `target_words`.
    Carries the last `overlap_sentences` into the next chunk for context
    continuity — equivalent to traditional word-overlap but at the
    sentence level, which is cleaner.
    """
    sentences = _split_sentences(text)
    if not sentences:
        return []

    chunks: list[Chunk] = []
    current: list[str] = []
    current_words = 0
    index = 0

    for sentence in sentences:
        word_count = len(sentence.split())
        if current_words + word_count > target_words and current:
            # Emit the accumulated chunk
            chunks.append(Chunk(
                text=" ".join(current),
                source=source,
                page=page,
                chunk_index=index,
            ))
            index += 1
            # Keep the last few sentences as overlap
            current = current[-overlap_sentences:] if overlap_sentences else []
            current_words = sum(len(s.split()) for s in current)
        current.append(sentence)
        current_words += word_count

    # Emit any remaining text
    if current:
        chunks.append(Chunk(
            text=" ".join(current),
            source=source,
            page=page,
            chunk_index=index,
        ))

    return chunks


def ingest_pdf(file: bytes, source: str) -> list[Chunk]:
    reader = PdfReader(io.BytesIO(file))
    chunks: list[Chunk] = []

    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            chunks.extend(sentence_aware_chunk(text, source=source, page=page_num))

    return chunks


def ingest_url(url: str) -> list[Chunk]:
    response = httpx.get(url, timeout=10, follow_redirects=True)
    soup = BeautifulSoup(response.text, "html.parser")

    for tag in soup.find_all(["script", "style", "nav", "footer"]):
        tag.decompose()
    text = soup.get_text(separator=' ')
    text = re.sub(r'\s+', ' ', text).strip()

    return sentence_aware_chunk(text, source=url, page=None)


def ingest_text(text: str, source: str = "pasted text") -> list[Chunk]:
    return sentence_aware_chunk(text, source=source, page=None)

