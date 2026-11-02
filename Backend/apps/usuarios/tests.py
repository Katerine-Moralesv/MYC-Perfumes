import re
import threading
import time
from datetime import timedelta
from unittest.mock import patch

from django.core.cache import cache
from django.test import override_settings
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase
from rest_framework_simplejwt.tokens import AccessToken

from apps.usuarios.models import RecuperacionPassword, Usuario


class AutenticacionTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_auth",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cls.vendedor = Usuario.objects.create_user(
            username="vendedor_auth",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )
        cls.superusuario = Usuario.objects.create_superuser(
            username="super_auth",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )

    def setUp(self):
        cache.clear()

    def test_login_retorna_access_y_refresh(self):
        respuesta = self.client.post(
            "/api/v1/auth/login/",
            {
                "username": "admin_auth",
                "password": "clave-segura-123",
            },
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertIn("access", respuesta.data)
        self.assertIn("refresh", respuesta.data)

        perfil = self.client.get(
            "/api/v1/usuarios/perfil/",
            HTTP_AUTHORIZATION=f"Bearer {respuesta.data['access']}",
        )
        self.assertEqual(perfil.status_code, status.HTTP_200_OK)
        self.assertEqual(perfil.data["rol"], Usuario.Rol.ADMIN)
        self.assertFalse(perfil.data["is_superuser"])

    def test_login_con_credenciales_invalidas_es_rechazado(self):
        respuesta = self.client.post(
            "/api/v1/auth/login/",
            {
                "username": "admin_auth",
                "password": "clave-incorrecta",
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_refresh_token_emite_nuevo_access(self):
        login = self.client.post(
            "/api/v1/auth/login/",
            {
                "username": "admin_auth",
                "password": "clave-segura-123",
            },
            format="json",
        )

        self.assertEqual(login.status_code, status.HTTP_200_OK)

        respuesta = self.client.post(
            "/api/v1/auth/refresh/",
            {"refresh": login.data["refresh"]},
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertIn("access", respuesta.data)

    def test_token_invalido_es_rechazado_en_endpoint_privado(self):
        respuesta = self.client.get(
            "/api/v1/usuarios/perfil/",
            HTTP_AUTHORIZATION="Bearer token-invalido",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_token_vencido_es_rechazado_en_endpoint_privado(self):
        token = AccessToken.for_user(self.admin)
        token.set_exp(lifetime=timedelta(seconds=-1))

        respuesta = self.client.get(
            "/api/v1/usuarios/perfil/",
            HTTP_AUTHORIZATION=f"Bearer {token}",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_perfil_requiere_autenticacion(self):
        respuesta = self.client.get("/api/v1/usuarios/perfil/")

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_perfil_no_permite_cambiar_rol(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.patch(
            "/api/v1/usuarios/perfil/",
            {"rol": "admin"},
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

        self.vendedor.refresh_from_db()
        self.assertEqual(
            self.vendedor.rol,
            Usuario.Rol.VENDEDOR,
        )

    def test_superusuario_con_rol_vendedor_conserva_acceso_admin(self):
        self.client.force_authenticate(user=self.superusuario)

        respuesta = self.client.get("/api/v1/usuarios/usuarios/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

    def test_listado_usuarios_expone_is_superuser_para_rol_efectivo(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.get("/api/v1/usuarios/usuarios/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

        fila = next(
            item
            for item in respuesta.data
            if item["id"] == self.superusuario.id
        )

        self.assertTrue(fila["is_superuser"])
        self.assertEqual(fila["rol"], Usuario.Rol.VENDEDOR)

    def test_vendedor_no_puede_listar_usuarios(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.get("/api/v1/usuarios/usuarios/")

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_admin_puede_listar_usuarios(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.get("/api/v1/usuarios/usuarios/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

    def test_perfil_permite_actualizar_username_y_email(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.patch(
            "/api/v1/usuarios/perfil/",
            {
                "username": "vendedor_actualizado",
                "email": "vendedor@example.com",
            },
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

        self.vendedor.refresh_from_db()
        self.assertEqual(self.vendedor.username, "vendedor_actualizado")
        self.assertEqual(self.vendedor.email, "vendedor@example.com")

    def test_admin_puede_crear_actualizar_y_eliminar_usuario(self):
        self.client.force_authenticate(user=self.admin)

        crear = self.client.post(
            "/api/v1/usuarios/usuarios/",
            {
                "username": "usuario_nuevo",
                "email": "nuevo@example.com",
                "rol": Usuario.Rol.VENDEDOR,
                "password": "clave-segura-456",
                "is_active": True,
            },
            format="json",
        )

        self.assertEqual(crear.status_code, status.HTTP_201_CREATED)
        usuario_id = crear.data["id"]

        actualizar = self.client.patch(
            f"/api/v1/usuarios/usuarios/{usuario_id}/",
            {
                "rol": Usuario.Rol.ADMIN,
                "is_active": False,
            },
            format="json",
        )

        self.assertEqual(actualizar.status_code, status.HTTP_200_OK)

        usuario = Usuario.objects.get(pk=usuario_id)
        self.assertEqual(usuario.rol, Usuario.Rol.ADMIN)
        self.assertFalse(usuario.is_active)

        eliminar = self.client.delete(
            f"/api/v1/usuarios/usuarios/{usuario_id}/"
        )

        self.assertEqual(
            eliminar.status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertFalse(Usuario.objects.filter(pk=usuario_id).exists())

    @override_settings(
        EMAIL_BACKEND=(
            "django.core.mail.backends.console.EmailBackend"
        )
    )
    def test_solicitar_recuperacion_es_publico(self):
        respuesta = self.client.post(
            "/api/v1/usuarios/password/solicitar/",
            {"email": "no-existe@example.com"},
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

    def test_verificar_codigo_es_publico_y_rechaza_datos_invalidos(self):
        respuesta = self.client.post(
            "/api/v1/usuarios/password/verificar/",
            {
                "email": "no-existe@example.com",
                "codigo": "123456",
            },
            format="json",
        )

        self.assertNotEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    @override_settings(
        EMAIL_BACKEND=(
            "django.core.mail.backends.console.EmailBackend"
        )
    )
    @patch("apps.usuarios.views.send_mail")
    def test_flujo_completo_de_recuperacion_de_password(
        self,
        send_mail_mock,
    ):
        self.admin.email = "admin_auth@example.com"
        self.admin.save(update_fields=["email"])

        solicitud = self.client.post(
            "/api/v1/usuarios/password/solicitar/",
            {"email": self.admin.email},
            format="json",
        )

        self.assertEqual(solicitud.status_code, status.HTTP_200_OK)
        send_mail_mock.assert_called_once()

        mensaje = send_mail_mock.call_args.kwargs["message"]
        coincidencia = re.search(
            r"código de recuperación es: (\d{6})",
            mensaje,
        )
        self.assertIsNotNone(coincidencia)

        codigo = coincidencia.group(1)

        verificacion = self.client.post(
            "/api/v1/usuarios/password/verificar/",
            {
                "email": self.admin.email,
                "codigo": codigo,
            },
            format="json",
        )

        self.assertEqual(verificacion.status_code, status.HTTP_200_OK)
        self.assertIn("reset_token", verificacion.data)

        restablecer = self.client.post(
            "/api/v1/usuarios/password/restablecer/",
            {
                "email": self.admin.email,
                "reset_token": verificacion.data["reset_token"],
                "new_password": "nueva-clave-456",
            },
            format="json",
        )

        self.assertEqual(restablecer.status_code, status.HTTP_200_OK)

        self.admin.refresh_from_db()
        self.assertTrue(self.admin.check_password("nueva-clave-456"))

        codigo_reutilizado = self.client.post(
            "/api/v1/usuarios/password/verificar/",
            {
                "email": self.admin.email,
                "codigo": codigo,
            },
            format="json",
        )
        token_reutilizado = self.client.post(
            "/api/v1/usuarios/password/restablecer/",
            {
                "email": self.admin.email,
                "reset_token": verificacion.data["reset_token"],
                "new_password": "otra-clave-789",
            },
            format="json",
        )

        self.assertEqual(
            codigo_reutilizado.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            token_reutilizado.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.admin.refresh_from_db()
        self.assertTrue(
            self.admin.check_password("nueva-clave-456")
        )

    @override_settings(
        EMAIL_BACKEND=(
            "django.core.mail.backends.smtp.EmailBackend"
        ),
        EMAIL_HOST="",
    )
    def test_smtp_no_configurado_no_revela_correo_ni_crea_codigo(self):
        self.admin.email = "admin_auth@example.com"
        self.admin.save(update_fields=["email"])

        for email in (
            self.admin.email,
            "no-existe@example.com",
        ):
            respuesta = self.client.post(
                "/api/v1/usuarios/password/solicitar/",
                {"email": email},
                format="json",
            )

            self.assertEqual(
                respuesta.status_code,
                status.HTTP_503_SERVICE_UNAVAILABLE,
            )
            self.assertNotIn("codigo", respuesta.data)

        self.assertFalse(
            RecuperacionPassword.objects.filter(
                usuario=self.admin
            ).exists()
        )

    @override_settings(
        EMAIL_BACKEND=(
            "django.core.mail.backends.console.EmailBackend"
        )
    )
    @patch("apps.usuarios.views.send_mail")
    def test_fallo_del_proveedor_no_confirma_envio(
        self,
        send_mail_mock,
    ):
        self.admin.email = "admin_auth@example.com"
        self.admin.save(update_fields=["email"])
        send_mail_mock.side_effect = RuntimeError(
            "fallo simulado del proveedor"
        )

        respuesta = self.client.post(
            "/api/v1/usuarios/password/solicitar/",
            {"email": self.admin.email},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
        self.assertNotIn("codigo", respuesta.data)
        recuperacion = RecuperacionPassword.objects.get(
            usuario=self.admin
        )
        self.assertIsNotNone(recuperacion.usado_en)

    @override_settings(
        EMAIL_BACKEND=(
            "django.core.mail.backends.console.EmailBackend"
        ),
        PASSWORD_RECOVERY_EMAIL_WAIT_SECONDS=0,
    )
    @patch("apps.usuarios.views.send_mail")
    def test_solicitud_responde_aunque_el_correo_siga_en_curso(
        self,
        send_mail_mock,
    ):
        self.admin.email = "admin_auth@example.com"
        self.admin.save(update_fields=["email"])

        inicio = threading.Event()
        liberar = threading.Event()

        def enviar_lento(**kwargs):
            inicio.set()
            liberar.wait(timeout=2)
            return 1

        send_mail_mock.side_effect = enviar_lento

        try:
            respuesta = self.client.post(
                "/api/v1/usuarios/password/solicitar/",
                {"email": self.admin.email},
                format="json",
            )

            self.assertEqual(
                respuesta.status_code,
                status.HTTP_200_OK,
            )
            self.assertTrue(inicio.wait(timeout=1))
        finally:
            liberar.set()
            time.sleep(0.1)

    def test_codigo_expirado_no_permite_verificar(self):
        cache.clear()
        self.admin.email = "admin_auth@example.com"
        self.admin.save(update_fields=["email"])
        RecuperacionPassword.crear_recuperacion(
            usuario=self.admin,
            codigo="123456",
            expira_en=timezone.now() - timedelta(minutes=1),
        )

        respuesta = self.client.post(
            "/api/v1/usuarios/password/verificar/",
            {
                "email": self.admin.email,
                "codigo": "123456",
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    @override_settings(
        EMAIL_BACKEND=(
            "django.core.mail.backends.console.EmailBackend"
        )
    )
    @patch("apps.usuarios.views.send_mail")
    def test_codigo_se_bloquea_tras_cinco_intentos(
        self,
        send_mail_mock,
    ):
        cache.clear()
        self.admin.email = "admin_auth@example.com"
        self.admin.save(update_fields=["email"])

        solicitud = self.client.post(
            "/api/v1/usuarios/password/solicitar/",
            {"email": self.admin.email},
            format="json",
        )
        self.assertEqual(solicitud.status_code, status.HTTP_200_OK)
        mensaje = send_mail_mock.call_args.kwargs["message"]
        codigo = re.search(
            r"código de recuperación es: (\d{6})",
            mensaje,
        ).group(1)

        for _ in range(5):
            respuesta = self.client.post(
                "/api/v1/usuarios/password/verificar/",
                {
                    "email": self.admin.email,
                    "codigo": "000000",
                },
                format="json",
            )
            self.assertEqual(
                respuesta.status_code,
                status.HTTP_400_BAD_REQUEST,
            )

        bloqueado = self.client.post(
            "/api/v1/usuarios/password/verificar/",
            {
                "email": self.admin.email,
                "codigo": codigo,
            },
            format="json",
        )

        self.assertEqual(
            bloqueado.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_restablecer_password_es_publico_y_rechaza_token_invalido(self):
        respuesta = self.client.post(
            "/api/v1/usuarios/password/restablecer/",
            {
                "email": "no-existe@example.com",
                "reset_token": "token-invalido-de-prueba",
                "new_password": "nueva-clave-123",
            },
            format="json",
        )

        self.assertNotEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
