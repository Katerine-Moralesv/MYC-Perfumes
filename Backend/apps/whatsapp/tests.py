import hashlib
import hmac
import json

from django.test import SimpleTestCase, override_settings


@override_settings(
    WHATSAPP_VERIFY_TOKEN="verify-token-prueba",
    WHATSAPP_APP_SECRET="app-secret-prueba",
)
class WhatsAppWebhookTests(SimpleTestCase):
    url = "/api/v1/whatsapp/webhook/"

    def test_verificacion_correcta_devuelve_challenge(self):
        respuesta = self.client.get(
            self.url,
            {
                "hub.mode": "subscribe",
                "hub.verify_token": "verify-token-prueba",
                "hub.challenge": "challenge-123",
            },
        )

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(
            respuesta.content.decode("utf-8"),
            "challenge-123",
        )

    def test_verificacion_con_token_incorrecto_es_rechazada(self):
        respuesta = self.client.get(
            self.url,
            {
                "hub.mode": "subscribe",
                "hub.verify_token": "incorrecto",
                "hub.challenge": "challenge-123",
            },
        )

        self.assertEqual(respuesta.status_code, 403)

    @override_settings(WHATSAPP_VERIFY_TOKEN="")
    def test_verificacion_sin_configuracion_es_segura(self):
        respuesta = self.client.get(
            self.url,
            {
                "hub.mode": "subscribe",
                "hub.verify_token": "cualquiera",
                "hub.challenge": "challenge-123",
            },
        )

        self.assertEqual(respuesta.status_code, 503)

    def _post_firmado(self, payload, *, firma=None):
        cuerpo = json.dumps(payload)
        firma_calculada = "sha256=" + hmac.new(
            b"app-secret-prueba",
            cuerpo.encode("utf-8"),
            hashlib.sha256,
        ).hexdigest()

        return self.client.post(
            self.url,
            data=cuerpo,
            content_type="application/json",
            HTTP_X_HUB_SIGNATURE_256=firma or firma_calculada,
        )

    def test_webhook_con_firma_valida_es_aceptado(self):
        respuesta = self._post_firmado({
            "object": "whatsapp_business_account",
            "entry": [],
        })

        self.assertEqual(respuesta.status_code, 200)
        self.assertEqual(respuesta.json(), {"received": True})

    def test_webhook_con_firma_invalida_es_rechazado(self):
        respuesta = self._post_firmado(
            {
                "object": "whatsapp_business_account",
                "entry": [],
            },
            firma="sha256=incorrecta",
        )

        self.assertEqual(respuesta.status_code, 403)

    @override_settings(WHATSAPP_APP_SECRET="")
    def test_webhook_sin_secreto_falla_cerrado(self):
        respuesta = self.client.post(
            self.url,
            data=json.dumps({
                "object": "whatsapp_business_account",
                "entry": [],
            }),
            content_type="application/json",
        )

        self.assertEqual(respuesta.status_code, 503)
