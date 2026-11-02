from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import patch

from django.core.cache import cache
from django.test import TestCase
from rest_framework import status
from rest_framework.test import APITestCase

from firebase_admin import messaging

from apps.catalogo.models import Categoria, Producto
from apps.notificaciones.models import DispositivoFCM
from apps.notificaciones.services.firebase_messaging import (
    enviar_notificacion_pedido,
)
from apps.pedidos.models import Pedido
from apps.usuarios.models import Usuario


class DispositivoFCMEndpointsTests(APITestCase):
    registrar_url = "/api/v1/notificaciones/dispositivos/"
    desactivar_url = (
        "/api/v1/notificaciones/dispositivos/desactivar/"
    )

    def setUp(self):
        self.admin = Usuario.objects.create_user(
            username="admin_fcm",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        self.otro_admin = Usuario.objects.create_user(
            username="admin_fcm_2",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        self.vendedor = Usuario.objects.create_user(
            username="vendedor_fcm",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )

    def test_administrador_registra_dispositivo(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            self.registrar_url,
            {"token": "token-admin-123", "plataforma": "web"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertTrue(respuesta.data["activo"])
        self.assertEqual(respuesta.data["plataforma"], "web")

        dispositivo = DispositivoFCM.objects.get(
            token="token-admin-123"
        )
        self.assertEqual(dispositivo.usuario, self.admin)
        self.assertTrue(dispositivo.activo)

    def test_superusuario_tambien_puede_registrar(self):
        superusuario = Usuario.objects.create_superuser(
            username="super_fcm",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )
        self.client.force_authenticate(user=superusuario)

        respuesta = self.client.post(
            self.registrar_url,
            {"token": "token-super-123"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )

    def test_vendedor_no_puede_registrar_dispositivo(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.post(
            self.registrar_url,
            {"token": "token-vendedor-123"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertFalse(
            DispositivoFCM.objects.filter(
                token="token-vendedor-123"
            ).exists()
        )

    def test_usuario_no_autenticado_es_rechazado(self):
        respuesta = self.client.post(
            self.registrar_url,
            {"token": "token-anonimo-123"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(DispositivoFCM.objects.count(), 0)

    def test_actualiza_token_existente_sin_duplicar(self):
        self.client.force_authenticate(user=self.admin)

        primera = self.client.post(
            self.registrar_url,
            {"token": "token-existente-123", "plataforma": "web"},
            format="json",
        )
        segunda = self.client.post(
            self.registrar_url,
            {
                "token": "token-existente-123",
                "plataforma": "android",
            },
            format="json",
        )

        self.assertEqual(
            primera.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            segunda.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(DispositivoFCM.objects.count(), 1)

        dispositivo = DispositivoFCM.objects.get(
            token="token-existente-123"
        )
        self.assertEqual(dispositivo.plataforma, "android")
        self.assertTrue(dispositivo.activo)

    def test_desactiva_dispositivo_propio(self):
        self.client.force_authenticate(user=self.admin)
        DispositivoFCM.objects.create(
            usuario=self.admin,
            token="token-desactivar-123",
        )

        respuesta = self.client.post(
            self.desactivar_url,
            {"token": "token-desactivar-123"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        self.assertTrue(respuesta.data["desactivado"])

        dispositivo = DispositivoFCM.objects.get(
            token="token-desactivar-123"
        )
        self.assertFalse(dispositivo.activo)

    def test_desactivar_es_idempotente(self):
        self.client.force_authenticate(user=self.admin)
        DispositivoFCM.objects.create(
            usuario=self.admin,
            token="token-idempotente-123",
            activo=False,
        )

        respuesta = self.client.post(
            self.desactivar_url,
            {"token": "token-idempotente-123"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        self.assertTrue(respuesta.data["desactivado"])

    def test_no_desactiva_token_de_otro_usuario(self):
        self.client.force_authenticate(user=self.admin)
        DispositivoFCM.objects.create(
            usuario=self.otro_admin,
            token="token-ajeno-123",
        )

        respuesta = self.client.post(
            self.desactivar_url,
            {"token": "token-ajeno-123"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        self.assertFalse(respuesta.data["desactivado"])
        self.assertTrue(
            DispositivoFCM.objects.get(
                token="token-ajeno-123"
            ).activo
        )

    def test_token_vacio_es_rechazado(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            self.registrar_url,
            {"token": "   "},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )


class EnvioNotificacionesTests(TestCase):
    def setUp(self):
        self.admin = Usuario.objects.create_user(
            username="admin_destino",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        self.superusuario = Usuario.objects.create_superuser(
            username="super_destino",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )
        self.vendedor = Usuario.objects.create_user(
            username="vendedor_destino",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )
        self.admin_inactivo = Usuario.objects.create_user(
            username="admin_inactivo",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
            is_active=False,
        )

        DispositivoFCM.objects.create(
            usuario=self.admin,
            token="token-admin-activo",
        )
        DispositivoFCM.objects.create(
            usuario=self.superusuario,
            token="token-super-activo",
        )
        DispositivoFCM.objects.create(
            usuario=self.vendedor,
            token="token-vendedor",
        )
        DispositivoFCM.objects.create(
            usuario=self.admin,
            token="token-admin-inactivo",
            activo=False,
        )
        DispositivoFCM.objects.create(
            usuario=self.admin_inactivo,
            token="token-usuario-inactivo",
        )

        self.pedido = SimpleNamespace(
            pk=99,
            total=Decimal("150000.00"),
            cliente=SimpleNamespace(nombre="Clienta Prueba"),
        )

    @staticmethod
    def _respuesta(*errores):
        respuestas = [
            SimpleNamespace(
                success=error is None,
                exception=error,
            )
            for error in errores
        ]

        return SimpleNamespace(
            responses=respuestas,
            success_count=sum(
                1 for error in errores if error is None
            ),
        )

    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "obtener_app_firebase"
    )
    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "messaging.send_each"
    )
    def test_envia_solo_a_administradores_activos(
        self,
        send_each,
        obtener_app,
    ):
        obtener_app.return_value = object()
        send_each.return_value = self._respuesta(None, None)

        enviados = enviar_notificacion_pedido(self.pedido)

        self.assertEqual(enviados, 2)
        mensajes = send_each.call_args.args[0]
        tokens = {mensaje.token for mensaje in mensajes}

        self.assertEqual(
            tokens,
            {"token-admin-activo", "token-super-activo"},
        )
        self.assertNotIn("token-vendedor", tokens)
        self.assertNotIn("token-admin-inactivo", tokens)
        self.assertNotIn("token-usuario-inactivo", tokens)

    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "obtener_app_firebase"
    )
    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "messaging.send_each"
    )
    def test_incluye_datos_para_abrir_el_pedido(
        self,
        send_each,
        obtener_app,
    ):
        obtener_app.return_value = object()
        send_each.return_value = self._respuesta(None)

        enviar_notificacion_pedido(self.pedido)

        mensaje = send_each.call_args.args[0][0]
        self.assertEqual(mensaje.data["pedido_id"], "99")
        self.assertEqual(mensaje.data["tipo"], "pedido_nuevo")
        self.assertEqual(mensaje.data["url"], "/?pedido=99")
        self.assertIn("Nuevo pedido #99", mensaje.data["titulo"])

    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "obtener_app_firebase"
    )
    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "messaging.send_each"
    )
    def test_desactiva_tokens_invalidos(
        self,
        send_each,
        obtener_app,
    ):
        obtener_app.return_value = object()

        def respuesta_por_token(mensajes, app=None):
            return self._respuesta(*[
                (
                    messaging.UnregisteredError(
                        "token inválido"
                    )
                    if mensaje.token == "token-admin-activo"
                    else None
                )
                for mensaje in mensajes
            ])

        send_each.side_effect = respuesta_por_token

        enviar_notificacion_pedido(self.pedido)

        self.assertFalse(
            DispositivoFCM.objects.get(
                token="token-admin-activo"
            ).activo
        )
        self.assertTrue(
            DispositivoFCM.objects.get(
                token="token-super-activo"
            ).activo
        )

    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "obtener_app_firebase"
    )
    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "messaging.send_each"
    )
    def test_un_error_de_firebase_no_se_propaga(
        self,
        send_each,
        obtener_app,
    ):
        obtener_app.return_value = object()
        send_each.side_effect = RuntimeError("Firebase caído")

        enviados = enviar_notificacion_pedido(self.pedido)

        self.assertEqual(enviados, 0)

    @patch(
        "apps.notificaciones.services.firebase_messaging."
        "obtener_app_firebase"
    )
    def test_sin_firebase_configurado_no_envia(self, obtener_app):
        obtener_app.return_value = None

        self.assertEqual(
            enviar_notificacion_pedido(self.pedido),
            0,
        )


class IntegracionNotificacionPedidoTests(APITestCase):
    url = "/api/v1/pedidos/tienda/"

    def setUp(self):
        cache.clear()

        self.categoria = Categoria.objects.create(
            nombre="Categoría FCM"
        )
        self.producto = Producto.objects.create(
            categoria=self.categoria,
            nombre="Perfume FCM",
            descripcion="Producto de prueba",
            precio=Decimal("100000.00"),
            contenido_ml=100,
            dias_entrega=1,
            activo=True,
        )

    def tearDown(self):
        cache.clear()

    def _payload(self):
        return {
            "telefono": "3001234567",
            "nombre_cliente": "Clienta FCM",
            "lineas": [
                {
                    "producto_id": self.producto.id,
                    "recarga_solicitada": False,
                    "cantidad": 1,
                }
            ],
        }

    @patch(
        "apps.pedidos.services.captura.notificar_pedido_creado"
    )
    def test_solo_notifica_una_vez_por_idempotencia(
        self,
        notificar,
    ):
        with self.captureOnCommitCallbacks(execute=True):
            primera = self.client.post(
                self.url,
                self._payload(),
                format="json",
                HTTP_IDEMPOTENCY_KEY="fcm-clave-0001",
            )

        with self.captureOnCommitCallbacks(execute=True):
            segunda = self.client.post(
                self.url,
                self._payload(),
                format="json",
                HTTP_IDEMPOTENCY_KEY="fcm-clave-0001",
            )

        self.assertEqual(
            primera.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            segunda.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(Pedido.objects.count(), 1)
        notificar.assert_called_once_with(
            Pedido.objects.get().pk
        )

    @patch(
        "apps.notificaciones.services.pedidos."
        "enviar_notificacion_pedido"
    )
    def test_fallo_de_firebase_no_revierte_el_pedido(
        self,
        enviar,
    ):
        enviar.side_effect = RuntimeError("Firebase caído")

        with self.captureOnCommitCallbacks(execute=True):
            respuesta = self.client.post(
                self.url,
                self._payload(),
                format="json",
                HTTP_IDEMPOTENCY_KEY="fcm-clave-0002",
            )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(Pedido.objects.count(), 1)
        enviar.assert_called_once()

    @patch(
        "apps.pedidos.services.captura.notificar_pedido_creado"
    )
    def test_pedido_invalido_no_dispara_notificacion(
        self,
        notificar,
    ):
        with self.captureOnCommitCallbacks(execute=True):
            respuesta = self.client.post(
                self.url,
                {**self._payload(), "lineas": []},
                format="json",
                HTTP_IDEMPOTENCY_KEY="fcm-clave-0003",
            )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)
        notificar.assert_not_called()
