"""Configuración de logging estructurado con structlog (patrón Nemesis)."""

from __future__ import annotations

import logging
import sys

import structlog


def configurar_logs(nivel: str = "INFO", *, json: bool = False) -> None:
    """Configura structlog: consola en desarrollo, JSON en producción."""
    logging.basicConfig(stream=sys.stdout, level=nivel, format="%(message)s")
    renderer = (
        structlog.processors.JSONRenderer()
        if json
        else structlog.dev.ConsoleRenderer(colors=True)
    )
    structlog.configure(
        processors=[
            structlog.contextvars.merge_contextvars,
            structlog.processors.add_log_level,
            structlog.processors.TimeStamper(fmt="iso"),
            structlog.processors.StackInfoRenderer(),
            renderer,
        ],
        wrapper_class=structlog.make_filtering_bound_logger(logging.getLevelName(nivel)),
        logger_factory=structlog.PrintLoggerFactory(),
        cache_logger_on_first_use=True,
    )


def get_logger(nombre: str | None = None) -> structlog.stdlib.BoundLogger:
    """Devuelve un logger estructurado."""
    return structlog.get_logger(nombre)
