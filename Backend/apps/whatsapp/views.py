import hashlib
import hmac
import json
import logging

from django.conf import settings
from django.http import HttpResponse
from rest_framework import status
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView


logger = logging.getLogger(__name__)


class WhatsAppWebhookView(APIView):
    """
    Verificación y recepción de webhooks de Meta.

    La integración actual solo envía notificaciones salientes. Este
    endpoint queda preparado para validar la firma y aceptar eventos
    futuros sin procesar lógica comercial.
    """

    permission_classes = [AllowAny]
    authentication_classes = []

    def get(self, request):
        verify_token = getattr(
            settings,
            "WHATSAPP_VERIFY_TOKEN",
            "",
        )

        if not verify_token:
            logger.error(
                "Webhook WhatsApp no configurado: falta "
                "WHATSAPP_VERIFY_TOKEN."
            )
            return Response(
                {"detail": "Webhook no configurado."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        modo = request.query_params.get("hub.mode")
        recibido = request.query_params.get("hub.verify_token", "")
        challenge = request.query_params.get("hub.challenge", "")

        if (
            modo == "subscribe"
            and recibido
            and hmac.compare_digest(recibido, verify_token)
        ):
            return HttpResponse(
                challenge,
                content_type="text/plain",
            )

        return Response(
            {"detail": "Verificación inválida."},
            status=status.HTTP_403_FORBIDDEN,
        )

    def post(self, request):
        app_secret = getattr(
            settings,
            "WHATSAPP_APP_SECRET",
            "",
        )

        if not app_secret:
            logger.error(
                "Webhook WhatsApp no configurado: falta "
                "WHATSAPP_APP_SECRET."
            )
            return Response(
                {"detail": "Webhook no configurado."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        firma = request.headers.get("X-Hub-Signature-256", "")
        esperada = "sha256=" + hmac.new(
            app_secret.encode("utf-8"),
            request.body,
            hashlib.sha256,
        ).hexdigest()

        if not firma or not hmac.compare_digest(
            firma,
            esperada,
        ):
            return Response(
                {"detail": "Firma inválida."},
                status=status.HTTP_403_FORBIDDEN,
            )

        try:
            evento = json.loads(request.body or b"{}")
        except (TypeError, ValueError):
            return Response(
                {"detail": "Carga inválida."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        if (
            not isinstance(evento, dict)
            or evento.get("object")
            != "whatsapp_business_account"
        ):
            return Response(
                {"detail": "Evento no reconocido."},
                status=status.HTTP_400_BAD_REQUEST,
            )

        entradas = evento.get("entry")
        cantidad = len(entradas) if isinstance(entradas, list) else 0
        logger.info(
            "Webhook de WhatsApp recibido con %s entrada(s).",
            cantidad,
        )

        return Response({"received": True})
