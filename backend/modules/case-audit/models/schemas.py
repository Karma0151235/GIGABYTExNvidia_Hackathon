from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, Field


class AuditSource(BaseModel):
    id: str = Field(pattern=r"^S\d{1,3}$")
    text: str = Field(min_length=1, max_length=2000)


class AuditMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(max_length=4000)


class AuditChatRequest(BaseModel):
    question: str = Field(min_length=1, max_length=1000)
    sources: list[AuditSource] = Field(default_factory=list, max_length=12)
    history: list[AuditMessage] = Field(default_factory=list, max_length=20)


class AuditChatResponse(BaseModel):
    answer: str
    model: str
    cited: list[str]
