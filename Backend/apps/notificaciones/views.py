from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.notificaciones.models import DispositivoFCM
from apps.notificaciones.serializers import (
    DesactivarDispositivoInputSerializer,
    DispositivoFCMSerializer,
    RegistrarDispositivoInputSerializer,
)
from apps.usuarios.permissions import EsAdministrador


class RegistrarDispositivoView(APIView):
    """
    Registra o actualiza el token FCM del administrador autenticado.

    Un vendedor o un usuario anónimo no puede registrar dispositivos.
    """

    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request):
        entrada = RegistrarDispositivoInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        token = entrada.validated_data["token"]
        plataforma = entrada.validated_data["plataforma"]

        dispositivo, creado = DispositivoFCM.objects.update_or_create(
            token=token,
            defaults={
                "usuario": request.user,
                "plataforma": plataforma,
                "activo": True,
            },
        )

        return Response(
            DispositivoFCMSerializer(dispositivo).data,
            status=(
                status.HTTP_201_CREATED
                if creado
                else status.HTTP_200_OK
            ),
        )


class DesactivarDispositivoView(APIView):
    """
    Desactiva únicamente un token que pertenezca al usuario actual.

    La respuesta es idempotente para no revelar si el token existe o
    pertenece a otra cuenta.
    """

    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request):
        entrada = DesactivarDispositivoInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        token = entrada.validated_data["token"]

        actualizados = DispositivoFCM.objects.filter(
            usuario=request.user,
            token=token,
        ).update(activo=False)

        return Response(
            {
                "detail": "Dispositivo desactivado.",
                "desactivado": bool(actualizados),
            },
            status=status.HTTP_200_OK,
        )
