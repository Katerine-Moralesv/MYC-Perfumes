import logging
from datetime import timedelta

from django.conf import settings
from django.contrib.auth.password_validation import validate_password
from django.core.mail import send_mail
from django.db import transaction
from django.utils import timezone

from rest_framework import generics, status
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.response import Response
from rest_framework.throttling import ScopedRateThrottle
from rest_framework.views import APIView
from rest_framework_simplejwt.views import TokenObtainPairView

from apps.usuarios.models import Usuario, RecuperacionPassword
from apps.usuarios.permissions import EsAdministrador
from apps.usuarios.serializers import (
    UsuarioSerializer,
    UsuarioPerfilSerializer,
    UsuarioAdminSerializer,
    SolicitarRecuperacionSerializer,
    VerificarCodigoSerializer,
    RestablecerPasswordSerializer,
)


logger = logging.getLogger(__name__)


def _smtp_configurado():
    if "smtp" not in settings.EMAIL_BACKEND.lower():
        return True

    return bool(settings.EMAIL_HOST)


class LoginView(TokenObtainPairView):
    """
    Login JWT con rate limiting.
    """

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "login"


class PerfilView(generics.RetrieveUpdateAPIView):
    """
    Permite al usuario consultar y editar únicamente su propio perfil.
    """

    serializer_class = UsuarioPerfilSerializer
    permission_classes = [IsAuthenticated]

    def get_object(self):
        return self.request.user


class UsuarioAdminListCreateView(generics.ListCreateAPIView):
    """
    CRUD administrativo:
    permite consultar y crear usuarios.

    Solo administradores.
    """

    queryset = Usuario.objects.all().order_by("id")
    serializer_class = UsuarioAdminSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]


class UsuarioAdminDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    CRUD administrativo:
    permite consultar, editar y eliminar usuarios.

    Solo administradores.
    """

    queryset = Usuario.objects.all()
    serializer_class = UsuarioAdminSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]


class SolicitarRecuperacionView(APIView):
    """
    Solicita un código temporal de recuperación de contraseña.

    Por seguridad, la respuesta no revela si el correo existe.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_recovery"

    def post(self, request):
        if not _smtp_configurado():
            logger.error(
                "El backend SMTP está seleccionado pero EMAIL_HOST "
                "no está configurado."
            )
            return Response(
                {
                    "detail": (
                        "El servicio de correo no está configurado. "
                        "Inténtalo más tarde."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        serializer = SolicitarRecuperacionSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"].strip()

        usuario = Usuario.objects.filter(
            email__iexact=email,
            is_active=True,
        ).first()

        mensaje = (
            "Si el correo está registrado, "
            "recibirás un código para recuperar tu contraseña."
        )

        if not usuario:
            return Response(
                {"detail": mensaje},
                status=status.HTTP_200_OK,
            )

        # Invalida recuperaciones anteriores todavía activas.
        RecuperacionPassword.objects.filter(
            usuario=usuario,
            usado_en__isnull=True,
            expira_en__gt=timezone.now(),
        ).update(
            usado_en=timezone.now()
        )

        codigo = RecuperacionPassword.generar_codigo()

        recuperacion = RecuperacionPassword.crear_recuperacion(
            usuario=usuario,
            codigo=codigo,
            expira_en=timezone.now() + timedelta(minutes=10),
        )

        try:
            enviados = send_mail(
                subject="Código de recuperación - MYC Perfumes",
                message=(
                    f"Hola {usuario.first_name or usuario.username},\n\n"
                    f"Tu código de recuperación es: {codigo}\n\n"
                    "Este código es válido durante 10 minutos.\n"
                    "Si no solicitaste recuperar tu contraseña, "
                    "puedes ignorar este mensaje.\n\n"
                    "MYC Perfumes"
                ),
                from_email=None,
                recipient_list=[usuario.email],
                fail_silently=False,
            )

            if not enviados:
                raise RuntimeError(
                    "El backend de correo no confirmó el envío."
                )
        except Exception as exc:
            logger.error(
                "No se pudo enviar el correo de recuperación: %s",
                type(exc).__name__,
            )
            recuperacion.usado_en = timezone.now()
            recuperacion.save(update_fields=["usado_en"])

            return Response(
                {
                    "detail": (
                        "No se pudo enviar el código de recuperación. "
                        "Inténtalo más tarde."
                    )
                },
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        return Response(
            {"detail": mensaje},
            status=status.HTTP_200_OK,
        )


class VerificarCodigoView(APIView):
    """
    Verifica el código recibido por correo.

    Si es válido, genera un token temporal para
    completar el cambio de contraseña.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_recovery_verify"

    @transaction.atomic
    def post(self, request):
        serializer = VerificarCodigoSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"].strip()
        codigo = serializer.validated_data["codigo"]

        usuario = Usuario.objects.filter(
            email__iexact=email,
            is_active=True,
        ).first()

        error = {
            "detail": "El código no es válido o ha expirado."
        }

        if not usuario:
            return Response(
                error,
                status=status.HTTP_400_BAD_REQUEST,
            )

        recuperacion = (
            RecuperacionPassword.objects
            .select_for_update()
            .filter(
                usuario=usuario,
                usado_en__isnull=True,
                verificado_en__isnull=True,
            )
            .order_by("-creado_en")
            .first()
        )

        if not recuperacion:
            return Response(
                error,
                status=status.HTTP_400_BAD_REQUEST,
            )

        if recuperacion.intentos >= 5:
            return Response(
                error,
                status=status.HTTP_400_BAD_REQUEST,
            )

        recuperacion.intentos += 1
        recuperacion.save(update_fields=["intentos"])

        if not recuperacion.codigo_valido(codigo):
            return Response(
                error,
                status=status.HTTP_400_BAD_REQUEST,
            )

        token = RecuperacionPassword.generar_token()

        from django.contrib.auth.hashers import make_password

        recuperacion.token_hash = make_password(token)
        recuperacion.verificado_en = timezone.now()

        recuperacion.save(
            update_fields=[
                "token_hash",
                "verificado_en",
            ]
        )

        return Response(
            {
                "detail": "Código verificado correctamente.",
                "reset_token": token,
            },
            status=status.HTTP_200_OK,
        )


class RestablecerPasswordView(APIView):
    """
    Establece una nueva contraseña utilizando
    un token temporal previamente verificado.
    """

    permission_classes = [AllowAny]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "password_recovery_reset"

    @transaction.atomic
    def post(self, request):
        serializer = RestablecerPasswordSerializer(
            data=request.data
        )
        serializer.is_valid(raise_exception=True)

        email = serializer.validated_data["email"].strip()
        reset_token = serializer.validated_data["reset_token"]
        new_password = serializer.validated_data["new_password"]

        usuario = Usuario.objects.filter(
            email__iexact=email,
            is_active=True,
        ).first()

        error = {
            "detail": "La solicitud de recuperación no es válida."
        }

        if not usuario:
            return Response(
                error,
                status=status.HTTP_400_BAD_REQUEST,
            )

        recuperacion = (
            RecuperacionPassword.objects
            .select_for_update()
            .filter(
                usuario=usuario,
                usado_en__isnull=True,
                verificado_en__isnull=False,
            )
            .order_by("-creado_en")
            .first()
        )

        if not recuperacion:
            return Response(
                error,
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not recuperacion.token_valido(reset_token):
            return Response(
                error,
                status=status.HTTP_400_BAD_REQUEST,
            )

        try:
            validate_password(
                new_password,
                user=usuario,
)
        except Exception as exc:
            from rest_framework import serializers

            if isinstance(exc, serializers.ValidationError):
                raise

            raise

        usuario.set_password(new_password)
        usuario.save(update_fields=["password"])

        recuperacion.usado_en = timezone.now()
        recuperacion.save(update_fields=["usado_en"])

        return Response(
            {
                "detail": (
                    "La contraseña fue restablecida correctamente."
                )
            },
            status=status.HTTP_200_OK,
        )