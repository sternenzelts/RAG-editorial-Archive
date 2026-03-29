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
    page:int | None
    chunk_index: int

def chunk_text(text: str, source: str, page: int | None, chunk_size: int =500, overlap: int=50)  -> list[Chunk]:
    words = text.split()
    chunks = []
    i = 0
    index=0

    while i < len(words):
        chunk_words = words[i:i+chunk_size]
        chunk_text = ' '.join(chunk_words)
        chunks.append(Chunk(text=chunk_text, source=source, page=page, chunk_index=index))
        i += chunk_size - overlap
        index+=1
    return chunks

def ingest_pdf(file: bytes, source: str) -> list[Chunk]:
    reader = PdfReader(io.BytesIO(file))
    chunks = []

    for page_num, page in enumerate(reader.pages, start=1):
        text = page.extract_text() or ""
        text = re.sub(r'\s+', ' ', text).strip()
        if text:
            chunks.extend(chunk_text(text, source=source, page=page_num))
    
    return chunks
    
def ingest_url(url: str) -> list[Chunk]:
    response = httpx.get(url, timeout=10, follow_redirects=True)
    soup = BeautifulSoup(response.text, "html.parser")

    for tag in soup.find_all(["script", "style", "nav", "footer"]):
        tag.decompose()
    text= soup.get_text(separator=' ')
    text = re.sub(r'\s+', ' ', text).strip()

    return chunk_text(text, source=url, page=None)

def ingest_text(text:str, source:str = "pasted text") -> list[Chunk]:

    return chunk_text(text, source=source, page=None)   

