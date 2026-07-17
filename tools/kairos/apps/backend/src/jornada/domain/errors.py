"""Excepciones de dominio (mismo patrón que Nemesis: nunca lanzar strings)."""

from __future__ import annotations


class DomainError(Exception):
    """Error base del dominio. Lleva un código estable para mapear a HTTP."""

    code: str = "DOMAIN_ERROR"

    def __init__(self, message: str, *, code: str | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code


class ValidationError(DomainError):
    """Datos de entrada inválidos (horas fuera de rango, formato incorrecto)."""

    code = "VALIDATION_ERROR"


class ConfigError(DomainError):
    """Configuración legal ausente o inconsistente (p. ej. fecha sin vigencia)."""

    code = "CONFIG_ERROR"
