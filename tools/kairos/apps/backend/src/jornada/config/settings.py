"""Configuración de la aplicación leída de variables de entorno (.env)."""

from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Settings de la app. Los nombres mapean a variables APP_*/API_*/DB_*."""

    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    # App
    app_env: str = "development"
    app_log_level: str = "INFO"
    app_timezone: str = "America/Bogota"
    app_debug: bool = True
    # Selector "ver como" SIN contraseña (header X-Demo-User). Es un bypass de login: por
    # eso viene APAGADO y hay que encenderlo a propósito (APP_DEMO_LOGIN=1) solo en local.
    # Antes dependía de que app_env fuera exactamente "production": si esa variable faltaba
    # o venía mal escrita ("prod", "Production"), el sistema quedaba abierto a cualquiera.
    app_demo_login: bool = False
    # Dominio de la cookie de sesión. En producción: ".productodeportivas.com" — así la
    # cookie puesta por api.productodeportivas.com también viaja desde
    # productodeportivas.com/atlas (mismo SITIO, distinto origen) y basta con SameSite=Lax.
    # Vacío en local = solo el host actual.
    app_cookie_domain: str = ""

    # API
    api_host: str = "127.0.0.1"
    api_port: int = 8020
    api_cors_origins: str = "http://localhost:5173"

    # Auth
    firebase_project_id: str = "deportivasvirtualsoft"
    # JWT local (mientras no se integra el SSO del hub/Firebase). En prod, sobreescribir
    # JWT_SECRET (así se llama la variable, SIN prefijo APP_) por una clave larga y aleatoria.
    jwt_secret: str = "dev-secret-cambiar-en-produccion"
    jwt_expira_horas: int = 12
    # URL del frontend para armar los enlaces de onboarding (crear contraseña).
    frontend_base_url: str = "http://localhost:5180"

    # SMTP (correo de onboarding). Vacío = no envía, solo loguea la URL.
    smtp_host: str = ""
    smtp_port: int = 587
    smtp_user: str = ""
    smtp_pass: str = ""
    smtp_from: str = ""   # si vacío, usa smtp_user

    # Integración Buk (HR): trae colaboradores/áreas. El TOKEN es un secreto → va SOLO por
    # variable de entorno (BUK_TOKEN), NUNCA en código ni en la BD ni en el front.
    buk_tenant: str = ""        # subdominio: si tu Buk es https://virtualsoft.buk.co → "virtualsoft"
    buk_token: str = ""         # auth_token generado en Buk (Configuración › Accesos API), solo lectura
    buk_pais: str = "colombia"  # define la ruta: /api/v1/colombia/...
    buk_sync_horas: int = 0     # 0 = manual; >0 = sincroniza solo cada N horas (auto)

    def buk_configurado(self) -> bool:
        return bool(self.buk_tenant and self.buk_token)

    def cors_origins_list(self) -> list[str]:
        """Lista de orígenes CORS a partir del CSV configurado."""
        return [o.strip() for o in self.api_cors_origins.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    """Devuelve la instancia única de settings (cacheada)."""
    return Settings()
