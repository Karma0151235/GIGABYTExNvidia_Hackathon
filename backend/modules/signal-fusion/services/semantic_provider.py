from __future__ import annotations
import math
import os
from dataclasses import dataclass
from typing import Protocol

class EmbeddingProvider(Protocol):
    name: str
    def embed_many(self, texts: list[str]) -> list[list[float]]: ...

class SentenceTransformerProvider:
    def __init__(self, model_name: str) -> None:
        from sentence_transformers import SentenceTransformer
        self.name = f"local:{model_name}"
        self.model = SentenceTransformer(model_name, local_files_only=True)
    def embed_many(self, texts: list[str]) -> list[list[float]]:
        values = self.model.encode(texts, normalize_embeddings=True, show_progress_bar=False)
        return values.tolist()

class LocalNgramProvider:
    name = "local:hashing-word-char"
    def __init__(self) -> None:
        from sklearn.feature_extraction.text import HashingVectorizer
        self.word = HashingVectorizer(n_features=768, alternate_sign=False, norm="l2", ngram_range=(1, 2), stop_words="english")
        self.char = HashingVectorizer(analyzer="char_wb", n_features=512, alternate_sign=False, norm="l2", ngram_range=(3, 5))
    def embed_many(self, texts: list[str]) -> list[list[float]]:
        import numpy as np
        word = self.word.transform(texts).toarray()
        char = self.char.transform(texts).toarray()
        combined = np.concatenate((word * 0.72, char * 0.28), axis=1)
        norms = np.linalg.norm(combined, axis=1, keepdims=True)
        return (combined / np.maximum(norms, 1e-12)).tolist()

def cosine(left: list[float], right: list[float]) -> float:
    dot = sum(a * b for a, b in zip(left, right))
    l_norm = math.sqrt(sum(value * value for value in left))
    r_norm = math.sqrt(sum(value * value for value in right))
    return dot / max(1e-12, l_norm * r_norm)

@dataclass(frozen=True)
class SemanticResult:
    vector: list[float]
    category: str
    title: str
    severity: int
    confidence: float

class SemanticAnalyzer:
    categories = {
        "Road accident": "traffic collision, vehicle crash, motorcycle accident, rollover, road victims or people trapped in vehicles",
        "Medical": "medical emergency, unconscious patient, cardiac arrest, breathing problem, severe injury or acute illness",
        "Hazmat": "fire, smoke, gas leak, chemical spill, explosion or hazardous material exposure",
        "Flood": "flash flood, rising water, stranded vehicles, overflowing river or dangerous storm water",
        "Public safety": "violence, crowd danger, structural collapse, missing person or other immediate public safety threat",
    }
    titles = {
        "Road accident": "Traffic collision",
        "Medical": "Acute medical emergency",
        "Hazmat": "Hazardous materials event",
        "Flood": "Rapid flooding event",
        "Public safety": "Emerging public safety event",
    }
    severity_anchors = [
        "minor non-urgent event with no injuries and no immediate danger",
        "serious emergency requiring rapid professional response",
        "immediate life threat with unconscious victims, entrapment, active fire or mass casualties",
    ]

    def __init__(self) -> None:
        self.degraded_reason: str | None = None
        self.provider = self._select_provider()
        self._references: list[list[float]] | None = None

    def _select_provider(self) -> EmbeddingProvider:
        requested = os.getenv("SIGNAL_FUSION_EMBEDDING_PROVIDER", "local").lower()
        if requested != "hashing":
            model = os.getenv("SIGNAL_FUSION_LOCAL_MODEL", "sentence-transformers/all-MiniLM-L6-v2")
            try:
                return SentenceTransformerProvider(model)
            except Exception as exc:
                self.degraded_reason = f"Local model unavailable: {type(exc).__name__}"
        return LocalNgramProvider()

    def _embed(self, texts: list[str]) -> list[list[float]]:
        try:
            return self.provider.embed_many(texts)
        except Exception as exc:
            if isinstance(self.provider, LocalNgramProvider): raise
            self.degraded_reason = f"{self.provider.name} failed: {type(exc).__name__}"
            self.provider = LocalNgramProvider()
            self._references = None
            return self.provider.embed_many(texts)

    def analyze(self, transcript: str, location: str) -> SemanticResult:
        text = f"Emergency report at {location}: {transcript}"
        reference_texts = list(self.categories.values()) + self.severity_anchors
        if self._references is None:
            vectors = self._embed([text, *reference_texts])
            vector, self._references = vectors[0], vectors[1:]
        else:
            vector = self._embed([text])[0]
        category_vectors = self._references[:len(self.categories)]
        category_scores = [cosine(vector, item) for item in category_vectors]
        best_index = max(range(len(category_scores)), key=category_scores.__getitem__)
        category = list(self.categories)[best_index]
        severity_vectors = self._references[len(self.categories):]
        severity_scores = [cosine(vector, item) for item in severity_vectors]
        weighted_level = sum(index * max(0.0, score) for index, score in enumerate(severity_scores)) / max(0.01, sum(max(0.0, score) for score in severity_scores))
        category_floor = {"Road accident": 58, "Medical": 62, "Hazmat": 64, "Flood": 55, "Public safety": 52}[category]
        severity = round(min(99, max(category_floor, 42 + weighted_level * 27)))
        confidence = max(0.0, category_scores[best_index] - sorted(category_scores)[-2])
        return SemanticResult(vector, category, self.titles[category], severity, confidence)

    def diagnostics(self) -> dict[str, str | bool | None]:
        return {"provider": self.provider.name, "ai_enabled": self.provider.name.startswith("local:" ) and not isinstance(self.provider, LocalNgramProvider), "degraded_reason": self.degraded_reason}
