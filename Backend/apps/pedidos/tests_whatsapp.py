import io
import json
import urllib.error
from decimal import Decimal
from unittest.mock import MagicMock, patch

from django.core.cache import cache
from django.test import override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import Categoria, Producto
from apps.pedidos.models import Pedido
from apps.pedidos.services.captura import registrar_pedido
from apps.pedidos.services.confirmacion import confirmar_pedido
from apps.pedidos.services.notificaciones import (
    construir_mensaje_nuevo_pedido,
    notificar_pedido_creado,
)
from apps.usuarios.models import Usuario
from apps.whatsapp.models import NotificacionWhatsApp


@override_settings(
    WHATSAPP_ACCESS_TOKEN="token-de-prueba",
    WHATSAPP_PHONE_NUMBER_ID="123456789012345",
    WHATSAPP_ADMIN_NUMBER="3001234567",
    WHATSAPP_API_VERSION="v23.0",
    WHATSAPP_TIMEOUT_SECONDS=5,
    WHATSAPP_TEMPLATE_NAME="",
    WHATSAPP_TEMPLATE_LANGUAGE="es",
    WHATSAPP_ENABLED=True,
    WHATSAPP_NOTIFICATIONS_ENABLED=True,
)
class WhatsAppNotificationTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_whatsapp",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(
            nombre="Perfumes WhatsApp"
        )

        cls.producto_a = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume A",
            precio=Decimal("150000.00"),
        )
        cls.producto_b = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume B",
            precio=Decimal("120000.00"),
        )

    def setUp(self):
        cache.clear()

    def tearDown(self):
        cache.clear()

    def _lineas_dos_productos(self):
        return [
            {
                "producto_id": self.producto_a.id,
                "recarga_solicitada": False,
                "cantidad": 2,
            },
            {
                "producto_id": self.producto_b.id,
                "recarga_solicitada": False,
                "cantidad": 1,
            },
        ]

    def _crear_pedido(self, lineas=None, telefono="3001234567"):
        with patch(
            "apps.pedidos.services.notificaciones."
            "notificar_pedido_creado"
        ):
            with self.captureOnCommitCallbacks(execute=True):
                return registrar_pedido(
                    telefono=telefono,
                    nombre_cliente="Clienta WhatsApp",
                    lineas=lineas or self._lineas_dos_productos(),
                )

    def _respuesta_http_ok(self):
        respuesta = MagicMock()
        respuesta.status = 200
        respuesta.read.return_value = (
            b'{"messages":[{"id":"wamid.prueba"}]}'
        )
        respuesta.__enter__.return_value = respuesta
        respuesta.__exit__.return_value = False
        return respuesta

    def test_pedido_valido_se_guarda_correctamente(self):
        pedido = self._crear_pedido()

        self.assertTrue(
            Pedido.objects.filter(pk=pedido.pk).exists()
        )
        self.assertEqual(pedido.total, Decimal("420000.00"))
        self.assertEqual(pedido.detalles.count(), 2)

    def test_despues_de_guardar_se_programa_la_notificacion(self):
        with patch(
            "apps.pedidos.services.notificaciones."
            "notificar_pedido_creado"
        ) as notificar:
            with self.captureOnCommitCallbacks(execute=True):
                pedido = registrar_pedido(
                    telefono="3001234568",
                    nombre_cliente="Clienta WhatsApp",
                    lineas=self._lineas_dos_productos(),
                )

        notificar.assert_called_once_with(pedido.id)

    def test_mensaje_incluye_id_resumen_y_productos(self):
        pedido = self._crear_pedido()

        mensaje = construir_mensaje_nuevo_pedido(pedido)

        self.assertIn(f"Pedido: #{pedido.id}", mensaje)
        self.assertIn("2 líneas (3 unidades)", mensaje)
        self.assertIn("Perfume A (40%) x2", mensaje)
        self.assertIn("Perfume B (40%) x1", mensaje)
        self.assertIn("$420.000 COP", mensaje)
        self.assertIn("Cliente: Clienta WhatsApp", mensaje)
        self.assertIn("Fecha:", mensaje)
        self.assertNotIn("3001234567", mensaje)

    def test_total_se_toma_del_pedido_guardado(self):
        pedido = self._crear_pedido()

        pedido.total = Decimal("123456.00")
        pedido.save(update_fields=["total"])

        mensaje = construir_mensaje_nuevo_pedido(pedido)

        self.assertIn("$123.456 COP", mensaje)

    @patch("apps.core.services.whatsapp.urlopen")
    def test_solicitud_http_usa_valores_del_backend(
        self,
        urlopen_mock,
    ):
        pedido = self._crear_pedido()
        urlopen_mock.return_value = self._respuesta_http_ok()

        self.assertTrue(
            notificar_pedido_creado(pedido.id)
        )

        solicitud = urlopen_mock.call_args.args[0]
        payload = json.loads(
            solicitud.data.decode("utf-8")
        )

        self.assertEqual(
            payload["messaging_product"],
            "whatsapp",
        )
        self.assertEqual(payload["to"], "573001234567")
        self.assertEqual(payload["type"], "text")

        cuerpo = payload["text"]["body"]

        self.assertIn(f"#{pedido.id}", cuerpo)
        self.assertIn("2 líneas (3 unidades)", cuerpo)
        self.assertIn("$420.000 COP", cuerpo)

    @override_settings(
        WHATSAPP_TEMPLATE_NAME="nuevo_pedido_myc",
        WHATSAPP_TEMPLATE_LANGUAGE="es_CO",
    )
    @patch("apps.core.services.whatsapp.urlopen")
    def test_modo_plantilla_usa_parametros_del_pedido(
        self,
        urlopen_mock,
    ):
        pedido = self._crear_pedido()
        urlopen_mock.return_value = self._respuesta_http_ok()

        self.assertTrue(
            notificar_pedido_creado(pedido.id)
        )

        solicitud = urlopen_mock.call_args.args[0]
        payload = json.loads(
            solicitud.data.decode("utf-8")
        )

        self.assertEqual(payload["type"], "template")
        self.assertEqual(
            payload["template"]["name"],
            "nuevo_pedido_myc",
        )
        self.assertEqual(
            payload["template"]["language"]["code"],
            "es_CO",
        )

        parametros = payload["template"]["components"][0][
            "parameters"
        ]

        self.assertEqual(len(parametros), 5)
        self.assertEqual(
            parametros[0]["text"],
            f"#{pedido.id}",
        )
        self.assertEqual(
            parametros[1]["text"],
            "Clienta WhatsApp",
        )
        self.assertIn(
            "2 l",
            parametros[2]["text"],
        )
        self.assertIn(
            "(3 unidades)",
            parametros[2]["text"],
        )
        self.assertIn(
            "$420.000 COP",
            parametros[3]["text"],
        )
        self.assertRegex(
            parametros[4]["text"],
            r"\d{2}/\d{2}/\d{4} \d{2}:\d{2}",
        )

    @patch("apps.core.services.whatsapp.urlopen")
    def test_error_de_whatsapp_no_elimina_el_pedido(
        self,
        urlopen_mock,
    ):
        urlopen_mock.side_effect = urllib.error.URLError(
            "sin conexión"
        )

        with self.assertLogs(
            "apps.core.services.whatsapp",
            level="ERROR",
        ):
            with self.captureOnCommitCallbacks(execute=True):
                pedido = registrar_pedido(
                    telefono="3001234569",
                    nombre_cliente="Clienta WhatsApp",
                    lineas=self._lineas_dos_productos(),
                )

        pedido.refresh_from_db()

        self.assertEqual(
            pedido.estado,
            Pedido.Estado.PENDIENTE,
        )
        self.assertTrue(
            Pedido.objects.filter(pk=pedido.id).exists()
        )
        self.assertEqual(pedido.total, Decimal("420000.00"))
        notificacion = NotificacionWhatsApp.objects.get(
            pedido=pedido
        )
        self.assertEqual(
            notificacion.estado,
            NotificacionWhatsApp.Estado.ERROR,
        )
        self.assertEqual(notificacion.intentos, 1)

    @patch(
        "apps.pedidos.services.notificaciones."
        "notificar_pedido_creado"
    )
    def test_cambios_de_estado_no_generan_notificacion(
        self,
        notificar_mock,
    ):
        pedido = self._crear_pedido()

        confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
        )

        notificar_mock.assert_not_called()

    @patch("apps.core.services.whatsapp.urlopen")
    def test_no_envia_notificaciones_duplicadas(
        self,
        urlopen_mock,
    ):
        pedido = self._crear_pedido()
        urlopen_mock.return_value = self._respuesta_http_ok()

        self.assertTrue(
            notificar_pedido_creado(pedido.id)
        )
        self.assertFalse(
            notificar_pedido_creado(pedido.id)
        )

        self.assertEqual(urlopen_mock.call_count, 1)
        notificacion = NotificacionWhatsApp.objects.get(
            pedido=pedido
        )
        self.assertEqual(
            notificacion.estado,
            NotificacionWhatsApp.Estado.ENVIADO,
        )
        self.assertEqual(notificacion.intentos, 1)
        self.assertEqual(
            notificacion.proveedor_mensaje_id,
            "wamid.prueba",
        )

    @override_settings(
        WHATSAPP_ENABLED=False,
        WHATSAPP_NOTIFICATIONS_ENABLED=False,
    )
    @patch("apps.core.services.whatsapp.urlopen")
    def test_deshabilitado_no_envia_ni_crea_historial(
        self,
        urlopen_mock,
    ):
        pedido = self._crear_pedido()

        self.assertFalse(notificar_pedido_creado(pedido.id))
        urlopen_mock.assert_not_called()
        self.assertFalse(
            NotificacionWhatsApp.objects.filter(
                pedido=pedido
            ).exists()
        )

    @override_settings(
        WHATSAPP_ACCESS_TOKEN="",
        WHATSAPP_PHONE_NUMBER_ID="",
        WHATSAPP_ADMIN_NUMBER="",
    )
    @patch("apps.core.services.whatsapp.urlopen")
    def test_ausencia_de_credenciales_es_segura(
        self,
        urlopen_mock,
    ):
        pedido = self._crear_pedido()

        with self.assertLogs(
            "apps.whatsapp.services.notificaciones",
            level="WARNING",
        ) as logs:
            resultado = notificar_pedido_creado(pedido.id)

        self.assertFalse(resultado)
        urlopen_mock.assert_not_called()
        self.assertTrue(
            Pedido.objects.filter(pk=pedido.id).exists()
        )

        salida = " ".join(logs.output)
        self.assertIn("no está configurado", salida)
        self.assertNotIn("token-de-prueba", salida)

    @patch("apps.core.services.whatsapp.urlopen")
    def test_errores_http_y_conexion_se_registran_sin_token(
        self,
        urlopen_mock,
    ):
        for indice, codigo in enumerate((401, 429)):
            cache.clear()
            pedido = self._crear_pedido(
                telefono=f"30012346{70 + indice}"
            )

            urlopen_mock.side_effect = urllib.error.HTTPError(
                "https://graph.facebook.com/v23.0/123/messages",
                codigo,
                "Error de prueba",
                {},
                io.BytesIO(
                    b'{"error":{"message":"fallo de prueba",'
                    b'"code":190}}'
                ),
            )

            with self.assertLogs(
                "apps.core.services.whatsapp",
                level="ERROR",
            ) as logs:
                self.assertFalse(
                    notificar_pedido_creado(pedido.id)
                )

            salida = " ".join(logs.output)

            self.assertIn(str(codigo), salida)
            self.assertNotIn("token-de-prueba", salida)
            notificacion = NotificacionWhatsApp.objects.get(
                pedido=pedido
            )
            self.assertEqual(
                notificacion.estado,
                NotificacionWhatsApp.Estado.ERROR,
            )
            self.assertTrue(notificacion.codigo_error)

        cache.clear()
        pedido_conexion = self._crear_pedido(
            telefono="3001234679"
        )
        urlopen_mock.side_effect = urllib.error.URLError(
            "sin red"
        )

        with self.assertLogs(
            "apps.core.services.whatsapp",
            level="ERROR",
        ) as logs:
            self.assertFalse(
                notificar_pedido_creado(pedido_conexion.id)
            )

        salida = " ".join(logs.output)

        self.assertIn("conectar", salida.lower())
        self.assertNotIn("token-de-prueba", salida)
        notificacion = NotificacionWhatsApp.objects.get(
            pedido=pedido_conexion
        )
        self.assertEqual(
            notificacion.codigo_error,
            "conexion",
        )

    @override_settings(WEBHOOK_TOKEN="token-webhook")
    def test_webhook_conserva_autenticacion(self):
        payload = {
            "telefono": "3001234570",
            "lineas": [
                {
                    "producto_id": self.producto_a.id,
                    "recarga_solicitada": False,
                    "cantidad": 1,
                }
            ],
        }

        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            payload,
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(Pedido.objects.count(), 0)

        with patch(
            "apps.pedidos.services.notificaciones."
            "notificar_pedido_creado"
        ) as notificar:
            with self.captureOnCommitCallbacks(execute=True):
                respuesta = self.client.post(
                    "/api/v1/pedidos/webhook/",
                    payload,
                    format="json",
                    HTTP_X_WEBHOOK_TOKEN="token-webhook",
                )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        notificar.assert_called_once_with(respuesta.data["id"])
