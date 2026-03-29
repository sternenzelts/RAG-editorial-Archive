import json
import os
import uuid
from dataclasses import dataclass, field, asdict
from datetime import datetime, timezone

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
WORKSPACE_PATH = os.path.join(BASE_DIR, "workspace_store.json")


@dataclass
class Collection:
    id: str
    name: str
    description: str
    sources: list  # list of source strings matching vector_store chunks
    status: str    # "drafting" | "finalized"
    synthesis: str # AI-generated markdown text
    created_at: str


class WorkspaceStore:
    def __init__(self):
        self.collections: list[Collection] = []
        self.load()

    # ── Persistence ────────────────────────────────────────────────────────────

    def save(self):
        try:
            data = {"collections": [asdict(c) for c in self.collections]}
            with open(os.path.abspath(WORKSPACE_PATH), "w") as f:
                json.dump(data, f, indent=2)
        except Exception as e:
            print(f"Failed to save workspace: {e}")

    def load(self):
        path = os.path.abspath(WORKSPACE_PATH)
        if not os.path.exists(path):
            return
        try:
            with open(path, "r") as f:
                data = json.load(f)
            self.collections = [
                Collection(**c) for c in data.get("collections", [])
            ]
            print(f"Loaded {len(self.collections)} collections from workspace")
        except Exception as e:
            print(f"Could not load workspace: {e}")

    # ── CRUD ───────────────────────────────────────────────────────────────────

    def create_collection(self, name: str, description: str = "") -> Collection:
        col = Collection(
            id=str(uuid.uuid4()),
            name=name,
            description=description,
            sources=[],
            status="drafting",
            synthesis="",
            created_at=datetime.now(timezone.utc).isoformat(),
        )
        self.collections.append(col)
        self.save()
        return col

    def get_collection(self, collection_id: str) -> Collection | None:
        return next((c for c in self.collections if c.id == collection_id), None)

    def delete_collection(self, collection_id: str) -> bool:
        before = len(self.collections)
        self.collections = [c for c in self.collections if c.id != collection_id]
        if len(self.collections) < before:
            self.save()
            return True
        return False

    def add_source(self, collection_id: str, source: str) -> bool:
        col = self.get_collection(collection_id)
        if col is None:
            return False
        if source not in col.sources:
            col.sources.append(source)
            self.save()
        return True

    def remove_source(self, collection_id: str, source: str) -> bool:
        col = self.get_collection(collection_id)
        if col is None:
            return False
        if source in col.sources:
            col.sources.remove(source)
            self.save()
        return True

    def set_synthesis(self, collection_id: str, synthesis: str):
        col = self.get_collection(collection_id)
        if col:
            col.synthesis = synthesis
            self.save()

    def set_status(self, collection_id: str, status: str):
        col = self.get_collection(collection_id)
        if col:
            col.status = status
            self.save()


workspace_store = WorkspaceStore()
