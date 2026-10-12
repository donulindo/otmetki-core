"""Independent educational primitives; no credentials or private service integrations."""

from .context import build_context, context_txt
from .store import Conflict, InvalidInput, NotFound, Store

__all__ = ["Store", "Conflict", "InvalidInput", "NotFound", "build_context", "context_txt"]
__version__ = "0.1.0"
