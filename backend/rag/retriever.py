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
        """Public search — uses MMR for diverse, relevant results."""
        return self.mmr_search(query, top_k=top_k, lambda_param=0.6)

    def mmr_search(
        self,
        query: str,
        top_k: int = 5,
        fetch_k: int = 20,
        lambda_param: float = 0.6,
    ) -> list[tuple[Chunk, float]]:
        """
        Maximal Marginal Relevance retrieval.

        Balances relevance (cosine similarity to the query) against
        diversity (dissimilarity to already-selected chunks).

        lambda_param:
          1.0  → pure relevance  (identical to flat cosine)
          0.0  → pure diversity
          0.6  → slightly relevance-biased (our default)

        Steps:
          1. Retrieve top `fetch_k` candidates by raw cosine similarity.
          2. Greedily pick the next chunk that maximises:
               lambda * sim(chunk, query) - (1-lambda) * max_sim(chunk, selected)
        """
        if not self.embeddings:
            return []

        query_embedding = self.embed(query)

        # Step 1: score all chunks against the query
        all_scores = [
            cosine_similarity(query_embedding, emb)
            for emb in self.embeddings
        ]

        # Step 2: take the top fetch_k candidates (wider pool for MMR to pick from)
        candidate_indices = np.argsort(all_scores)[::-1][:fetch_k].tolist()
        candidate_embeddings = [self.embeddings[i] for i in candidate_indices]
        candidate_scores = [all_scores[i] for i in candidate_indices]

        selected: list[int] = []   # indices into candidate_indices
        selected_embeddings: list[np.ndarray] = []

        while len(selected) < top_k and len(selected) < len(candidate_indices):
            best_idx = -1
            best_score = float("-inf")

            for ci, (emb, rel_score) in enumerate(zip(candidate_embeddings, candidate_scores)):
                if ci in selected:
                    continue

                # Redundancy penalty: max similarity to any already-selected chunk
                if selected_embeddings:
                    redundancy = max(
                        cosine_similarity(emb, sel_emb)
                        for sel_emb in selected_embeddings
                    )
                else:
                    redundancy = 0.0

                mmr_score = lambda_param * rel_score - (1 - lambda_param) * redundancy

                if mmr_score > best_score:
                    best_score = mmr_score
                    best_idx = ci

            if best_idx == -1:
                break

            selected.append(best_idx)
            selected_embeddings.append(candidate_embeddings[best_idx])

        # Map back to actual chunk indices and return with their raw relevance scores
        results = []
        for ci in selected:
            chunk_idx = candidate_indices[ci]
            results.append((self.chunks[chunk_idx], float(candidate_scores[ci])))

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
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


vector_store = VectorStore()

