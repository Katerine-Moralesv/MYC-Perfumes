import hashlib
import json
import re
import secrets

from django.conf import settings
from django.db import IntegrityError
from rest_framework import generics, status
from rest_framework.parsers import JSONParser
from rest_framework.views import APIView
from rest_framework.response import Response
from rest_framework.permissions import IsAuthenticated, AllowAny
from rest_framework.throttling import ScopedRateThrottle

from apps.core.utils import normalizar_telefono
from apps.finanzas.serializers import AbonoSerializer
from apps.pedidos.models import Pedido
from apps.pedidos.serializers import (
    PedidoSerializer,
    PedidoTiendaSerializer,
    RegistrarPedidoInputSerializer,
    RegistrarPedidoTiendaInputSerializer,
    ConfirmarPedidoInputSerializer,
    RechazarPedidoInputSerializer,
    RegistrarAnticipoInputSerializer,
    CancelarPedidoInputSerializer,
    CambiarEstadoPedidoInputSerializer,
)
from apps.pedidos.services.anticipos import registrar_anticipo
from apps.pedidos.services.cancelacion import cancelar_pedido
from apps.pedidos.services.cierre import (
    actualizar_estado_pedido,
    completar_venta_pedido,
)
from apps.pedidos.services.captura import registrar_pedido
from apps.pedidos.services.confirmacion import (
    confirmar_pedido,
    rechazar_pedido,
)
from apps.usuarios.permissions import EsAdministrador


IDEMPOTENCY_KEY_PATTERN = re.compile(
    r"^[A-Za-z0-9._:-]{8,64}$"
)


def _leer_idempotency_key(request, *, obligatoria=True):
    clave = (
        request.headers.get("Idempotency-Key", "") or ""
    ).strip()

    if not clave:
        if not obligatoria:
            return None, None

        return None, Response(
            {
                "detail": (
                    "Falta el encabezado Idempotency-Key. "
                    "Genera una clave única por operación."
                )
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    if not IDEMPOTENCY_KEY_PATTERN.fullmatch(clave):
        return None, Response(
            {
                "detail": (
                    "Idempotency-Key inválida. Usa entre 8 y 64 "
                    "caracteres alfanuméricos, punto, guion, "
                    "guion bajo o dos puntos."
                )
            },
            status=status.HTTP_400_BAD_REQUEST,
        )

    return clave, None


def _lineas_canonicas(lineas):
    resultado = []

    for linea in lineas:
        porcentaje = linea.get("porcentaje")

        if not linea["recarga_solicitada"]:
            porcentaje = 40

        resultado.append({
            "producto_id": int(linea["producto_id"]),
            "recarga_solicitada": bool(linea["recarga_solicitada"]),
            "porcentaje": int(porcentaje),
            "cantidad": int(linea["cantidad"]),
        })

    return sorted(
        resultado,
        key=lambda linea: (
            linea["producto_id"],
            linea["porcentaje"],
            linea["cantidad"],
        ),
    )


def _hash_solicitud(datos):
    contenido = {
        "telefono": normalizar_telefono(datos["telefono"]),
        "nombre_cliente": datos.get("nombre_cliente", "").strip(),
        "lineas": _lineas_canonicas(datos["lineas"]),
    }

    serializado = json.dumps(
        contenido,
        ensure_ascii=False,
        sort_keys=True,
        separators=(",", ":"),
    )

    return hashlib.sha256(
        serializado.encode("utf-8")
    ).hexdigest()


def _respuesta_pedido(pedido, reutilizado):
    data = PedidoTiendaSerializer(pedido).data
    data["reutilizado"] = reutilizado
    data["mensaje"] = (
        "Pedido registrado. Queda pendiente de confirmación administrativa."
        if not reutilizado
        else "Este pedido ya había sido registrado con la misma solicitud."
    )

    return data


class WebhookPedidoView(APIView):
    """
    Endpoint público utilizado por el bot de WhatsApp.

    No utiliza JWT porque el bot no es un usuario de la aplicación.
    En su lugar exige un token secreto enviado mediante:
        X-Webhook-Token: <token>

    También tiene rate limiting para reducir abuso básico.
    """

    permission_classes = [AllowAny]

    # El bot se autentica exclusivamente con X-Webhook-Token.
    # Una cabecera Authorization inválida no debe interferir.
    authentication_classes = []

    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "webhook"

    def post(self, request):
        expected_token = getattr(settings, "WEBHOOK_TOKEN", "")

        # Fail closed:
        # si el servidor no tiene configurado el secreto,
        # el webhook no debe quedar abierto accidentalmente.
        if not expected_token:
            return Response(
                {"detail": "Webhook no configurado."},
                status=status.HTTP_503_SERVICE_UNAVAILABLE,
            )

        provided_token = request.headers.get("X-Webhook-Token", "")

        if not provided_token or not secrets.compare_digest(
            provided_token,
            expected_token,
        ):
            return Response(
                {"detail": "Token de webhook inválido."},
                status=status.HTTP_401_UNAUTHORIZED,
            )

        entrada = RegistrarPedidoInputSerializer(
            data=request.data
        )

        entrada.is_valid(raise_exception=True)

        pedido = registrar_pedido(
            **entrada.validated_data
        )

        return Response(
            PedidoSerializer(pedido).data,
            status=status.HTTP_201_CREATED,
        )


class RegistrarPedidoTiendaView(APIView):
    """
    Crea un pedido pendiente desde el catálogo web público.

    No usa JWT ni el token del webhook. La idempotencia se controla
    con el encabezado Idempotency-Key y una restricción única en la
    base de datos. No crea ventas, abonos ni pagos.
    """

    permission_classes = [AllowAny]
    authentication_classes = []
    parser_classes = [JSONParser]
    throttle_classes = [ScopedRateThrottle]
    throttle_scope = "pedido_tienda"

    def post(self, request):
        clave_idempotencia = (
            request.headers.get("Idempotency-Key", "") or ""
        ).strip()

        if not clave_idempotencia:
            return Response(
                {
                    "detail": (
                        "Falta el encabezado Idempotency-Key. "
                        "Genera una clave única por intento de compra."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        if not IDEMPOTENCY_KEY_PATTERN.fullmatch(
            clave_idempotencia
        ):
            return Response(
                {
                    "detail": (
                        "Idempotency-Key inválida. Usa entre 8 y 64 "
                        "caracteres alfanuméricos, punto, guion, "
                        "guion bajo o dos puntos."
                    )
                },
                status=status.HTTP_400_BAD_REQUEST,
            )

        entrada = RegistrarPedidoTiendaInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        datos = entrada.validated_data
        hash_solicitud = _hash_solicitud(datos)

        pedido_existente = (
            Pedido.objects
            .filter(clave_idempotencia=clave_idempotencia)
            .first()
        )

        if pedido_existente is not None:
            if pedido_existente.hash_solicitud != hash_solicitud:
                return Response(
                    {
                        "detail": (
                            "La Idempotency-Key ya fue utilizada con "
                            "una solicitud distinta."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            return Response(
                _respuesta_pedido(pedido_existente, True),
                status=status.HTTP_200_OK,
            )

        try:
            pedido = registrar_pedido(
                telefono=datos["telefono"],
                nombre_cliente=datos.get("nombre_cliente", ""),
                lineas=datos["lineas"],
                clave_idempotencia=clave_idempotencia,
                hash_solicitud=hash_solicitud,
            )
        except IntegrityError:
            pedido_existente = (
                Pedido.objects
                .filter(clave_idempotencia=clave_idempotencia)
                .first()
            )

            if pedido_existente is None:
                raise

            if pedido_existente.hash_solicitud != hash_solicitud:
                return Response(
                    {
                        "detail": (
                            "La Idempotency-Key ya fue utilizada con "
                            "una solicitud distinta."
                        )
                    },
                    status=status.HTTP_409_CONFLICT,
                )

            return Response(
                _respuesta_pedido(pedido_existente, True),
                status=status.HTTP_200_OK,
            )

        return Response(
            _respuesta_pedido(pedido, False),
            status=status.HTTP_201_CREATED,
        )


class PedidoListView(generics.ListAPIView):
    """
    Panel administrativo de pedidos.

    Solo administradores y superusuarios. El modelo actual no tiene
    un campo de asignación de pedidos a vendedores, por lo que no
    existe una cartera de pedidos propia para el rol vendedor.
    """

    serializer_class = PedidoSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]

    
    def get_queryset(self):
        qs = (
            Pedido.objects
            .select_related("cliente", "venta")
            .prefetch_related(
                "detalles__producto",
                "detalles__presentacion__producto",
                "venta__abonos",
                "abonos",
                "devoluciones",
                "historial_estados__registrado_por",
            )
        )

        estado = self.request.query_params.get("estado")

        estados_validos = {
            valor for valor, _ in Pedido.Estado.choices
        }

        if estado:
            if estado not in estados_validos:
                from rest_framework.exceptions import ValidationError

                raise ValidationError({
                    "estado": "Estado de pedido inválido."
                })

            qs = qs.filter(estado=estado)

        return qs


class ConfirmarPedidoView(APIView):
    """
    Solo los administradores pueden confirmar pedidos.

    Body:
        estado_pago:
            "pendiente"  -> no se recibió dinero.
            "abonado"    -> pago parcial; exige monto_recibido.
            "pagado"     -> pago total.
        lineas_precio:
            Solo recargas 60/70/80 pendientes o a corregir.
        monto_recibido:
            Monto real recibido. Obligatorio para "abonado".
    """

    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request, pedido_id):
        entrada = ConfirmarPedidoInputSerializer(
            data=request.data
        )

        entrada.is_valid(raise_exception=True)

        pedido = confirmar_pedido(
            pedido_id=pedido_id,
            usuario=request.user,
            **entrada.validated_data,
        )

        return Response(
            PedidoSerializer(pedido).data,
            status=status.HTTP_200_OK,
        )


class AnticipoCreateView(APIView):
    """
    Registra un anticipo real de un pedido confirmado, sin crear Venta.
    """

    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request, pedido_id):
        clave, error = _leer_idempotency_key(request)

        if error is not None:
            return error

        entrada = RegistrarAnticipoInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        abono = registrar_anticipo(
            pedido_id=pedido_id,
            usuario=request.user,
            clave_idempotencia=clave,
            **entrada.validated_data,
        )

        pedido = (
            Pedido.objects
            .select_related("cliente", "venta")
            .prefetch_related(
                "detalles__producto",
                "detalles__presentacion__producto",
                "abonos",
                "venta__abonos",
                "historial_estados__registrado_por",
            )
            .filter(pk=pedido_id)
            .first()
        )

        return Response(
            {
                "pedido": PedidoSerializer(pedido).data,
                "anticipo": AbonoSerializer(abono).data,
            },
            status=status.HTTP_201_CREATED,
        )


class CompletarVentaPedidoView(APIView):
    """
    Genera la venta financiera única cuando ya existe costo real y
    todas las cantidades del pedido fueron recibidas.
    """

    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request, pedido_id):
        clave, error = _leer_idempotency_key(
            request,
            obligatoria=False,
        )

        if error is not None:
            return error

        completar_venta_pedido(
            pedido_id=pedido_id,
            usuario=request.user,
            clave_idempotencia=clave,
        )

        pedido = (
            Pedido.objects
            .select_related("cliente", "venta")
            .prefetch_related(
                "detalles__producto",
                "detalles__presentacion__producto",
                "abonos",
                "venta__abonos",
                "historial_estados__registrado_por",
            )
            .filter(pk=pedido_id)
            .first()
        )

        return Response(
            PedidoSerializer(pedido).data,
            status=status.HTTP_200_OK,
        )


class CancelarPedidoView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request, pedido_id):
        clave, error = _leer_idempotency_key(
            request,
            obligatoria=False,
        )

        if error is not None:
            return error

        entrada = CancelarPedidoInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        pedido = cancelar_pedido(
            pedido_id=pedido_id,
            usuario=request.user,
            clave_idempotencia=clave,
            **entrada.validated_data,
        )

        return Response(
            PedidoSerializer(pedido).data,
            status=status.HTTP_200_OK,
        )


class EstadoPedidoView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request, pedido_id):
        entrada = CambiarEstadoPedidoInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        pedido = actualizar_estado_pedido(
            pedido_id=pedido_id,
            usuario=request.user,
            nuevo_estado=entrada.validated_data["estado"],
            motivo=entrada.validated_data.get("motivo", ""),
        )

        return Response(
            PedidoSerializer(pedido).data,
            status=status.HTTP_200_OK,
        )


class RechazarPedidoView(APIView):
    """
    Solo los administradores pueden rechazar pedidos.
    """

    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request, pedido_id):
        entrada = RechazarPedidoInputSerializer(
            data=request.data
        )

        entrada.is_valid(raise_exception=True)

        pedido = rechazar_pedido(
            pedido_id=pedido_id,
            usuario=request.user,
            **entrada.validated_data,
        )

        return Response(
            PedidoSerializer(pedido).data,
            status=status.HTTP_200_OK,
        )