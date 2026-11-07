"""Knowledge-base retrieval and the per-run evidence store.

Evidence IDs are assigned here, by code, when a search tool returns a chunk.
Agents can only cite IDs that exist in a store, so a model cannot invent a source.
"""

from __future__ import annotations

import hashlib
import json
import math
import re
from collections import Counter
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable, Protocol

SNIPPET_CHARS = 1_200

KIND_BY_KB = {"competency": "Authoritative", "syllabus": "Faculty Example"}


@dataclass
class Chunk:
    text: str
    source_id: str
    title: str
    publisher: str
    version: str
    page: int | None
    score: float
    uri: str | None = None


@dataclass
class Evidence:
    evidence_id: str
    kb: str
    kind: str
    source_id: str
    title: str
    publisher: str
    version: str
    page: int | None
    snippet: str
    score: float

    def for_prompt(self) -> dict:
        return {
            "evidence_id": self.evidence_id,
            "title": self.title,
            "kind": self.kind,
            "page": self.page,
            "snippet": self.snippet,
        }


class EvidenceStore:
    """Collects every chunk a search tool returned during one analysis run."""

    def __init__(self, prefix: str, kb: str):
        self.prefix = prefix
        self.kb = kb
        self._items: dict[str, Evidence] = {}
        self._by_hash: dict[str, str] = {}

    def add(self, chunk: Chunk) -> Evidence:
        snippet = _clean(chunk.text)[:SNIPPET_CHARS]
        key = hashlib.sha256(f"{chunk.source_id}|{chunk.page}|{snippet}".encode()).hexdigest()
        if key in self._by_hash:
            return self._items[self._by_hash[key]]
        evidence = Evidence(
            evidence_id=f"{self.prefix}{len(self._items) + 1}",
            kb=self.kb,
            kind=KIND_BY_KB[self.kb],
            source_id=chunk.source_id,
            title=chunk.title,
            publisher=chunk.publisher,
            version=chunk.version,
            page=chunk.page,
            snippet=snippet,
            score=round(chunk.score, 4),
        )
        self._items[evidence.evidence_id] = evidence
        self._by_hash[key] = evidence.evidence_id
        return evidence

    def get(self, evidence_id: str) -> Evidence | None:
        return self._items.get(evidence_id)

    def __contains__(self, evidence_id: str) -> bool:
        return evidence_id in self._items

    def all(self) -> list[Evidence]:
        return list(self._items.values())


class Retriever(Protocol):
    def retrieve(self, query: str, top_k: int) -> list[Chunk]: ...


class BedrockKbRetriever:
    """Bedrock Knowledge Bases `Retrieve`, filtered to ACTIVE sources of one corpus version."""

    def __init__(self, kb_id: str, region: str, corpus_version: str | None = None, client=None):
        import boto3

        self.kb_id = kb_id
        self.corpus_version = corpus_version
        self.client = client or boto3.client("bedrock-agent-runtime", region_name=region)

    def _filter(self) -> dict:
        conditions = [{"equals": {"key": "status", "value": "ACTIVE"}}]
        if self.corpus_version:
            conditions.append({"equals": {"key": "corpus_version", "value": self.corpus_version}})
        return conditions[0] if len(conditions) == 1 else {"andAll": conditions}

    def retrieve(self, query: str, top_k: int) -> list[Chunk]:
        response = self.client.retrieve(
            knowledgeBaseId=self.kb_id,
            retrievalQuery={"text": query[:1_000]},
            retrievalConfiguration={
                "vectorSearchConfiguration": {"numberOfResults": top_k, "filter": self._filter()}
            },
        )
        chunks = []
        for item in response.get("retrievalResults", []):
            meta = item.get("metadata") or {}
            uri = (item.get("location") or {}).get("s3Location", {}).get("uri")
            page = meta.get("page")
            chunks.append(
                Chunk(
                    text=(item.get("content") or {}).get("text", ""),
                    source_id=str(meta.get("source_id") or uri or "unknown"),
                    title=str(meta.get("title") or (uri or "Untitled source").rsplit("/", 1)[-1]),
                    publisher=str(meta.get("publisher") or "ASPPH"),
                    version=str(meta.get("corpus_version") or self.corpus_version or ""),
                    page=int(page) if isinstance(page, (int, float)) else None,
                    score=float(item.get("score") or 0.0),
                    uri=uri,
                )
            )
        return chunks


class LocalCorpusRetriever:
    """BM25 over a corpus built by `phact_rag prepare`, for offline runs and tests.

    It reads the same page files and `.metadata.json` sidecars that are uploaded to S3,
    so local results use the same titles, pages and IDs as the real knowledge base.
    """

    def __init__(self, kb_dir: Path):
        self.docs: list[tuple[Chunk, Counter]] = []
        for text_path in sorted(Path(kb_dir).rglob("*.txt")):
            meta_path = text_path.with_name(text_path.name + ".metadata.json")
            meta = json.loads(meta_path.read_text("utf-8"))["metadataAttributes"] if meta_path.exists() else {}
            if meta.get("status", "ACTIVE") != "ACTIVE":
                continue
            text = text_path.read_text("utf-8")
            chunk = Chunk(
                text=text,
                source_id=meta.get("source_id", text_path.parent.name),
                title=meta.get("title", text_path.parent.name),
                publisher=meta.get("publisher", "ASPPH"),
                version=meta.get("corpus_version", "local"),
                page=meta.get("page"),
                score=0.0,
                uri=str(text_path),
            )
            self.docs.append((chunk, Counter(_tokens(text))))
        self.avg_len = sum(sum(c.values()) for _, c in self.docs) / max(len(self.docs), 1)
        self.df = Counter(term for _, counts in self.docs for term in counts)

    def retrieve(self, query: str, top_k: int) -> list[Chunk]:
        terms = set(_tokens(query))
        n = len(self.docs)
        scored = []
        for chunk, counts in self.docs:
            length = sum(counts.values())
            score = 0.0
            for term in terms:
                tf = counts.get(term, 0)
                if not tf:
                    continue
                idf = math.log(1 + (n - self.df[term] + 0.5) / (self.df[term] + 0.5))
                score += idf * tf * 2.2 / (tf + 1.2 * (0.25 + 0.75 * length / self.avg_len))
            if score > 0:
                scored.append((score, chunk))
        scored.sort(key=lambda pair: pair[0], reverse=True)
        return [Chunk(**{**asdict(chunk), "score": score}) for score, chunk in scored[:top_k]]


def make_search_tool(
    name: str, description: str, retriever: Retriever, store: EvidenceStore, top_k: int
) -> Callable[[str], str]:
    """Build a tool function that searches one KB and records what it returned."""

    def search(query: str) -> str:
        chunks = retriever.retrieve(query, top_k)
        results = [store.add(chunk).for_prompt() for chunk in chunks if chunk.text.strip()]
        if not results:
            return json.dumps({"results": [], "note": "No matching evidence in this knowledge base."})
        return json.dumps({"results": results}, ensure_ascii=False)

    search.__name__ = name
    search.__doc__ = description
    return search


_STOPWORDS = set("the a an and or of to in for on with by as is are be this that from at it its into".split())


def _tokens(text: str) -> list[str]:
    return [t for t in re.findall(r"[a-z0-9]+", text.lower()) if t not in _STOPWORDS and len(t) > 1]


def _clean(text: str) -> str:
    return re.sub(r"[ \t]+", " ", re.sub(r"\n{3,}", "\n\n", text)).strip()
