import json
import logging
import re
import socket
from dataclasses import dataclass
from urllib.error import HTTPError, URLError
from urllib.parse import quote
from urllib.request import Request, urlopen

from django.conf import settings

from apps.core.utils import normalizar_telefono


logger = logging.getLogger(__name__)

DEFAULT_API_VERSION = "v23.0"
DEFAULT_TIMEOUT_SECONDS = 10
MAX_ERROR_BODY = 2000


class WhatsAppError(Exception):
    """Error base del servicio de WhatsApp."""


class WhatsAppNotConfigured(WhatsAppError):
    """Faltan credenciales o la configuración no es válida."""


class WhatsAppAuthError(WhatsAppError):
    """Meta rechazó el token o los permisos de la aplicación."""


class WhatsAppRateLimitError(WhatsAppError):
    """Se alcanzó el límite de envíos de WhatsApp."""


class WhatsAppHTTPError(WhatsAppError):
    """La API respondió con un error HTTP."""


class WhatsAppConnectionError(WhatsAppError):
    """No fue posible conectar con la API de WhatsApp."""


@dataclass(frozen=True)
class WhatsAppConfig:
    access_token: str
    phone_number_id: str
    admin_number: str
    api_version: str = DEFAULT_API_VERSION
    timeout: int = DEFAULT_TIMEOUT_SECONDS
    template_name: str = ""
    template_language: str = "es"

    @property
    def template_configurada(self):
        return bool((self.template_name or "").strip())

    def validar(self):
        faltantes = []

        if not (self.access_token or "").strip():
            faltantes.append("WHATSAPP_ACCESS_TOKEN")

        if not (self.phone_number_id or "").strip():
            faltantes.append("WHATSAPP_PHONE_NUMBER_ID")

        if not (self.admin_number or "").strip():
            faltantes.append("WHATSAPP_ADMIN_NUMBER")

        if faltantes:
            raise WhatsAppNotConfigured(
                "Faltan variables de entorno de WhatsApp: "
                + ", ".join(faltantes)
            )

        if not self.phone_number_id.strip().isdigit():
            raise WhatsAppNotConfigured(
                "WHATSAPP_PHONE_NUMBER_ID debe contener solo dígitos."
            )

        if not (self.api_version or "").strip():
            raise WhatsAppNotConfigured(
                "WHATSAPP_API_VERSION no puede estar vacío."
            )

        if self.timeout <= 0:
            raise WhatsAppNotConfigured(
                "WHATSAPP_TIMEOUT_SECONDS debe ser mayor a cero."
            )


def obtener_configuracion():
    return WhatsAppConfig(
        access_token=getattr(
            settings,
            "WHATSAPP_ACCESS_TOKEN",
            "",
        ),
        phone_number_id=getattr(
            settings,
            "WHATSAPP_PHONE_NUMBER_ID",
            "",
        ),
        admin_number=(
            getattr(settings, "WHATSAPP_ADMIN_PHONE", "")
            or getattr(settings, "WHATSAPP_ADMIN_NUMBER", "")
        ),
        api_version=getattr(
            settings,
            "WHATSAPP_API_VERSION",
            DEFAULT_API_VERSION,
        ) or DEFAULT_API_VERSION,
        timeout=int(
            getattr(
                settings,
                "WHATSAPP_TIMEOUT_SECONDS",
                DEFAULT_TIMEOUT_SECONDS,
            )
            or DEFAULT_TIMEOUT_SECONDS
        ),
        template_name=getattr(
            settings,
            "WHATSAPP_TEMPLATE_NAME",
            "",
        ) or "",
        template_language=getattr(
            settings,
            "WHATSAPP_TEMPLATE_LANGUAGE",
            "es",
        ) or "es",
    )


def normalizar_destinatario(valor):
    """
    Meta espera el destinatario con indicativo internacional y sin '+'.
    Reutiliza la normalización de teléfonos del proyecto.
    """

    return normalizar_telefono(valor or "").lstrip("+")


def _sanitizar(texto, config):
    token = (config.access_token or "").strip()

    if token:
        texto = texto.replace(token, "[REDACTADO]")

    return texto


def _construir_payload(
    config,
    destinatario,
    texto,
    parametros_plantilla,
):
    if config.template_configurada:
        parametros = list(parametros_plantilla or [texto])

        return {
            "messaging_product": "whatsapp",
            "recipient_type": "individual",
            "to": destinatario,
            "type": "template",
            "template": {
                "name": config.template_name.strip(),
                "language": {
                    "code": config.template_language.strip() or "es",
                },
                "components": [
                    {
                        "type": "body",
                        "parameters": [
                            {
                                "type": "text",
                                "text": (str(parametro).strip() or "-")[:1024],
                            }
                            for parametro in parametros
                        ],
                    }
                ],
            },
        }

    return {
        "messaging_product": "whatsapp",
        "recipient_type": "individual",
        "to": destinatario,
        "type": "text",
        "text": {
            "preview_url": False,
            "body": texto[:4096],
        },
    }


def _detalle_error_http(cuerpo):
    try:
        data = json.loads(cuerpo)
    except (TypeError, ValueError):
        return cuerpo.strip()[:300], None, None

    error = data.get("error") if isinstance(data, dict) else None

    if not isinstance(error, dict):
        return cuerpo.strip()[:300], None, None

    mensaje = (
        error.get("error_user_msg")
        or error.get("message")
        or ""
    )

    return (
        str(mensaje).strip()[:300],
        error.get("code"),
        error.get("error_subcode"),
    )


def _leer_respuesta(cuerpo):
    if not cuerpo:
        return {}

    try:
        return json.loads(cuerpo)
    except (TypeError, ValueError):
        return {"raw": cuerpo[:500]}


def _enviar_solicitud(url, payload, config):
    data = json.dumps(payload).encode("utf-8")

    request = Request(
        url,
        data=data,
        method="POST",
        headers={
            "Authorization": f"Bearer {config.access_token}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        },
    )

    try:
        with urlopen(request, timeout=config.timeout) as response:
            status_code = getattr(response, "status", None)

            if status_code is None:
                status_code = response.getcode()

            cuerpo = response.read().decode(
                "utf-8",
                errors="replace",
            )

            if status_code and not 200 <= int(status_code) < 300:
                logger.error(
                    "WhatsApp respondió HTTP %s.",
                    status_code,
                )

                raise WhatsAppHTTPError(
                    f"WhatsApp respondió HTTP {status_code}."
                )

            return _leer_respuesta(cuerpo)
    except HTTPError as exc:
        cuerpo = exc.read().decode(
            "utf-8",
            errors="replace",
        )[:MAX_ERROR_BODY]

        mensaje, codigo, subcodigo = _detalle_error_http(cuerpo)
        mensaje = _sanitizar(
            mensaje or "sin detalle",
            config,
        )

        logger.error(
            "WhatsApp respondió HTTP %s (code=%s subcode=%s): %s",
            exc.code,
            codigo,
            subcodigo,
            mensaje,
        )

        if exc.code in (401, 403):
            raise WhatsAppAuthError(
                f"WhatsApp rechazó las credenciales (HTTP {exc.code})."
            ) from exc

        if exc.code == 429:
            raise WhatsAppRateLimitError(
                "WhatsApp alcanzó el límite de envíos (HTTP 429)."
            ) from exc

        raise WhatsAppHTTPError(
            f"WhatsApp respondió HTTP {exc.code}."
        ) from exc
    except (URLError, TimeoutError, socket.timeout, OSError) as exc:
        logger.error(
            "No se pudo conectar con WhatsApp: %s.",
            type(exc).__name__,
        )

        raise WhatsAppConnectionError(
            "No se pudo conectar con WhatsApp."
        ) from exc


def enviar_mensaje_whatsapp(
    texto,
    *,
    destinatario=None,
    parametros_plantilla=None,
    config=None,
):
    """
    Envía un mensaje por WhatsApp Cloud API.

    Si WHATSAPP_TEMPLATE_NAME está configurado, envía una plantilla con
    los parámetros de cuerpo indicados. De lo contrario, envía texto
    libre, válido dentro de la ventana de atención al cliente.
    """

    if not (texto or "").strip():
        raise WhatsAppError(
            "El mensaje de WhatsApp no puede estar vacío."
        )

    config = config or obtener_configuracion()
    config.validar()

    numero = normalizar_destinatario(
        destinatario or config.admin_number
    )

    if not re.fullmatch(r"\d{8,15}", numero or ""):
        raise WhatsAppNotConfigured(
            "El número destinatario de WhatsApp no es válido. "
            "Usa indicativo internacional sin '+'."
        )

    url = (
        "https://graph.facebook.com/"
        f"{quote(config.api_version.strip(), safe='')}/"
        f"{quote(config.phone_number_id.strip(), safe='')}/messages"
    )

    payload = _construir_payload(
        config,
        numero,
        texto.strip(),
        parametros_plantilla,
    )

    return _enviar_solicitud(url, payload, config)
