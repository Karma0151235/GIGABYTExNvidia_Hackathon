"""Signal Fusion handoff contract for downstream ANWAR modules.

Downstream modules should consume the HTTP event feed rather than importing
Signal Fusion internals. These aliases provide shared typing when direct Python
composition is useful in tests or a future in-process event bus.
"""

from importlib import import_module


_schemas = import_module("backend.modules.signal-fusion.models.schemas")

IncidentHandoff = _schemas.IncidentHandoff
IntegrationEvent = _schemas.IntegrationEvent
EventFeed = _schemas.EventFeed

__all__ = ["EventFeed", "IncidentHandoff", "IntegrationEvent"]
