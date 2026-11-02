from datetime import date, timedelta
from decimal import Decimal

from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.finanzas.models import Cliente, Venta
from apps.usuarios.models import Usuario


ORIGEN_CLOUDFLARE = "https://myc-perfumes.pages.dev"
URL_VENTAS = "/api/v1/finanzas/ventas/"


@override_settings(CORS_ALLOWED_ORIGINS=[ORIGEN_CLOUDFLARE])
class VentasCorsTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_cors_ventas",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cliente = Cliente.objects.create(
            nombre="Clienta CORS",
            telefono="3001239999",
        )
        cls.venta = Venta.objects.create(
            cliente=cliente,
            fecha=date.today(),
            estado_pago="pendiente",
            total=Decimal("100000.00"),
            saldo=Decimal("100000.00"),
            registrado_por=cls.admin,
        )

    def test_preflight_ventas_permite_authorization(self):
        respuesta = self.client.options(
            URL_VENTAS,
            HTTP_ORIGIN=ORIGEN_CLOUDFLARE,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="GET",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS=(
                "authorization,content-type"
            ),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            ORIGEN_CLOUDFLARE,
        )
        encabezados = respuesta[
            "access-control-allow-headers"
        ].lower()
        self.assertIn("authorization", encabezados)
        self.assertIn("content-type", encabezados)

    def test_get_ventas_con_jwt_valido_incluye_cors(self):
        token = AccessToken.for_user(self.admin)

        respuesta = self.client.get(
            URL_VENTAS,
            HTTP_ORIGIN=ORIGEN_CLOUDFLARE,
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            ORIGEN_CLOUDFLARE,
        )
        self.assertEqual(len(respuesta.data), 1)
        self.assertEqual(respuesta.data[0]["id"], self.venta.id)

    def test_get_ventas_con_jwt_expirado_incluye_cors(self):
        token = AccessToken.for_user(self.admin)
        token.set_exp(lifetime=timedelta(seconds=-1))

        respuesta = self.client.get(
            URL_VENTAS,
            HTTP_ORIGIN=ORIGEN_CLOUDFLARE,
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            ORIGEN_CLOUDFLARE,
        )

    def test_get_ventas_sin_jwt_incluye_cors(self):
        respuesta = self.client.get(
            URL_VENTAS,
            HTTP_ORIGIN=ORIGEN_CLOUDFLARE,
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            ORIGEN_CLOUDFLARE,
        )

    def test_get_ventas_inexistente_no_se_usa_como_error_cors(self):
        token = AccessToken.for_user(self.admin)

        respuesta = self.client.get(
            "/api/v1/finanzas/ventas/999999/",
            HTTP_ORIGIN=ORIGEN_CLOUDFLARE,
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_404_NOT_FOUND,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            ORIGEN_CLOUDFLARE,
        )
