"""Stable Live Dispatch contracts for downstream ANWAR modules."""

from importlib import import_module


_schemas = import_module("backend.modules.live-dispatch.models.schemas")

DispatchEvent = _schemas.DispatchEvent
DispatchEventFeed = _schemas.DispatchEventFeed
DispatchRecommendation = _schemas.DispatchRecommendation
DispatchSnapshot = _schemas.DispatchSnapshot
DispatchUnit = _schemas.DispatchUnit
Facility = _schemas.Facility

__all__ = [
    "DispatchEvent",
    "DispatchEventFeed",
    "DispatchRecommendation",
    "DispatchSnapshot",
    "DispatchUnit",
    "Facility",
]
