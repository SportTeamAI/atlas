"""Envío de correo. En despliegue usa SMTP (variables de entorno); en demo/dev
sin SMTP configurado solo lo registra en el log (no falla). Así la lógica de
recordatorios funciona igual y el envío real se activa poniendo las credenciales.
"""

from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage
from email.mime.multipart import MIMEMultipart
from email.mime.text import MIMEText

log = logging.getLogger("jornada.email")


_HTML_ONBOARDING = """\
<div style="font-family:sans-serif;max-width:480px;margin:0 auto;color:#1a1a1a">
  <div style="background:#16697A;padding:20px 32px">
    <span style="color:white;font-size:22px;font-weight:700;letter-spacing:.05em">Atlas</span>
    <span style="color:#9FCFD6;font-size:13px;margin-left:8px">&middot; Talento Humano</span>
  </div>
  <div style="padding:32px">
    <p style="font-size:16px;margin:0 0 8px">Hola, <strong>{primer_nombre}</strong> 👋</p>
    <p style="color:#555;margin:0 0 28px">Tu acceso a la plataforma interna está listo.<br>
    Haz clic para crear tu contraseña y entrar:</p>
    <div style="text-align:center;margin:0 0 32px">
      <a href="{link}"
         style="background:#16697A;color:white;padding:13px 28px;border-radius:8px;
                text-decoration:none;font-weight:600;font-size:15px;display:inline-block">
        Crear mi contraseña
      </a>
    </div>
    <p style="font-size:12px;color:#999;margin:0">
      Este enlace vence en 7&nbsp;días. Si no lo solicitaste, ignora este mensaje.
    </p>
  </div>
</div>
"""


def smtp_configurado() -> bool:
    return bool(os.environ.get("SMTP_HOST"))


def enviar_correo(destinatario: str, asunto: str, cuerpo: str) -> bool:
    """Devuelve True si se envió por SMTP; False si solo se simuló (sin SMTP)."""
    if not destinatario:
        return False
    if not smtp_configurado():
        # Demo/dev: sin SMTP no se envía nada real, se deja traza en el log.
        log.info("[correo simulado] para=%s asunto=%s", destinatario, asunto)
        return False
    msg = EmailMessage()
    msg["From"] = os.environ.get("SMTP_FROM", "no-reply@jornada.local")
    msg["To"] = destinatario
    msg["Subject"] = asunto
    msg.set_content(cuerpo)
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    with smtplib.SMTP(host, port, timeout=15) as srv:
        if os.environ.get("SMTP_TLS", "1") == "1":
            srv.starttls()
        usuario = os.environ.get("SMTP_USER")
        if usuario:
            srv.login(usuario, os.environ.get("SMTP_PASS", ""))
        srv.send_message(msg)
    return True


def enviar_onboarding(to_email: str, nombre: str, link: str) -> None:
    """Correo HTML de bienvenida con el enlace para crear contraseña (onboarding).
    Sin SMTP configurado: solo deja traza en el log con la URL (útil en desarrollo)."""
    primer_nombre = nombre.split()[0] if nombre else to_email
    if not smtp_configurado():
        log.info("[onboarding simulado] para=%s url=%s", to_email, link)
        return
    remitente = os.environ.get("SMTP_FROM", os.environ.get("SMTP_USER", "no-reply@atlas.local"))
    msg = MIMEMultipart("alternative")
    msg["From"] = remitente
    msg["To"] = to_email
    msg["Subject"] = "Tu acceso a Atlas está listo"
    msg.attach(MIMEText(_HTML_ONBOARDING.format(primer_nombre=primer_nombre, link=link), "html", "utf-8"))
    host = os.environ["SMTP_HOST"]
    port = int(os.environ.get("SMTP_PORT", "587"))
    try:
        with smtplib.SMTP(host, port, timeout=10) as s:
            s.ehlo()
            if os.environ.get("SMTP_TLS", "1") == "1":
                s.starttls()
            usuario = os.environ.get("SMTP_USER")
            if usuario:
                s.login(usuario, os.environ.get("SMTP_PASS", ""))
            s.sendmail(remitente, to_email, msg.as_string())
        log.info("email_onboarding_enviado to=%s", to_email)
    except Exception:
        log.exception("email_onboarding_fallo to=%s", to_email)
