import ollama
import numpy as np
import json
import os
from rag.ingestor import Chunk

# absolute path — always saves next to main.py in backend/
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
STORE_PATH = os.path.join(BASE_DIR, "..", "vector_store.json")


class VectorStore:
    def __init__(self):
        self.chunks: list[Chunk] = []
        self.embeddings: list[np.ndarray] = []
        self.load()  # load from disk on startup

    def embed(self, text: str) -> np.ndarray:
        response = ollama.embeddings(
            model="nomic-embed-text",
            prompt=text
        )
        return np.array(response["embedding"])

    def add_chunks(self, chunks: list[Chunk]):
        for chunk in chunks:
            embedding = self.embed(chunk.text)
            self.chunks.append(chunk)
            self.embeddings.append(embedding)
        self.save()  # save to disk after every upload

    def search(self, query: str, top_k: int = 5) -> list[tuple[Chunk, float]]:
        if not self.embeddings:
            return []

        query_embedding = self.embed(query)

        scores = []
        for embedding in self.embeddings:
            score = cosine_similarity(query_embedding, embedding)
            scores.append(score)

        top_indices = np.argsort(scores)[::-1][:top_k]

        results = []
        for i in top_indices:
            results.append((self.chunks[i], float(scores[i])))

        return results

    def clear(self):
        self.chunks = []
        self.embeddings = []
        path = os.path.abspath(STORE_PATH)
        print(f"Clearing store at: {path}")
        if os.path.exists(path):
            os.remove(path)
            print("Store deleted successfully")
        else:
            print("Store file not found — nothing to delete")

    def delete_source(self, source: str) -> int:
        """Remove all chunks belonging to a given source. Returns number removed."""
        indices_to_keep = [
            i for i, chunk in enumerate(self.chunks) if chunk.source != source
        ]
        removed = len(self.chunks) - len(indices_to_keep)
        self.chunks = [self.chunks[i] for i in indices_to_keep]
        self.embeddings = [self.embeddings[i] for i in indices_to_keep]
        if removed > 0:
            self.save()
        return removed

    def save(self):
        try:
            data = {
                "chunks": [
                    {
                        "text": c.text,
                        "source": c.source,
                        "page": c.page,
                        "chunk_index": c.chunk_index
                    }
                    for c in self.chunks
                ],
                "embeddings": [e.tolist() for e in self.embeddings]
            }
            path = os.path.abspath(STORE_PATH)
            with open(path, "w") as f:
                json.dump(data, f)
            print(f"Saved {len(self.chunks)} chunks to {path}")
        except Exception as e:
            print(f"Failed to save store: {e}")

    def load(self):
        path = os.path.abspath(STORE_PATH)
        if not os.path.exists(path):
            print("No existing store found — starting fresh")
            return
        try:
            with open(path, "r") as f:
                data = json.load(f)
            self.chunks = [
                Chunk(
                    text=c["text"],
                    source=c["source"],
                    page=c["page"],
                    chunk_index=c["chunk_index"]
                )
                for c in data["chunks"]
            ]
            self.embeddings = [np.array(e) for e in data["embeddings"]]
            print(f"Loaded {len(self.chunks)} chunks from {path}")
        except Exception as e:
            print(f"Could not load store: {e}")


def cosine_similarity(a: np.ndarray, b: np.ndarray) -> float:
    return np.dot(a, b) / (np.linalg.norm(a) * np.linalg.norm(b))


vector_store = VectorStore()
