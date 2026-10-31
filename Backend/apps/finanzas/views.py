
import re
from datetime import date

from django.db.models import Q
from django_filters.rest_framework import DjangoFilterBackend
from rest_framework import generics, status
from rest_framework.exceptions import ValidationError
from rest_framework.filters import OrderingFilter
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from apps.finanzas import selectors
from apps.finanzas.models import Compra, Cliente, Proveedor, Venta
from apps.finanzas.serializers import (
    CompraSerializer,
    VentaSerializer,
    ClienteSerializer,
    ProveedorSerializer,
    RegistrarCompraInputSerializer,
    RegistrarRecepcionInputSerializer,
    RegistrarVentaInputSerializer,
    RegistrarAbonoInputSerializer,
)
from apps.finanzas.services import clientes as clientes_service
from apps.finanzas.services.compras import (
    registrar_compra,
    registrar_recepcion,
)
from apps.finanzas.services.ventas import registrar_venta
from apps.finanzas.services.pagos import registrar_abono
from apps.finanzas.services import reportes
from apps.usuarios.permissions import EsAdministrador, es_administrador


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


# ============================================================
# VALIDACIÓN COMÚN DE FECHAS PARA REPORTES
# ============================================================

def validar_mes_reporte(mes):
    if not mes:
        raise ValidationError({
            "mes": "El parámetro mes es obligatorio."
        })

    if not re.fullmatch(r"\d{4}-(0[1-9]|1[0-2])", mes):
        raise ValidationError({
            "mes": "Usa el formato YYYY-MM con un mes válido."
        })

    try:
        date.fromisoformat(f"{mes}-01")
    except ValueError:
        raise ValidationError({
            "mes": "Usa el formato YYYY-MM con un mes válido."
        })

    return mes


def validar_fechas_reporte(
    fecha_inicio,
    fecha_fin,
    permitir_vacias=False,
):
    """
    Valida el formato YYYY-MM-DD y el orden de las fechas.

    Si permitir_vacias=True, ambas fechas pueden omitirse.
    Si se proporciona una sola fecha, se valida y se utiliza
    como límite inferior o superior, según corresponda.
    """

    if not permitir_vacias and (
        not fecha_inicio or not fecha_fin
    ):
        raise ValidationError({
            "fechas": (
                "fecha_inicio y fecha_fin son requeridos."
            )
        })

    fechas = []

    for nombre, valor in (
        ("fecha_inicio", fecha_inicio),
        ("fecha_fin", fecha_fin),
    ):
        if not valor:
            fechas.append(None)
            continue

        try:
            fecha_validada = date.fromisoformat(valor)
        except (TypeError, ValueError):
            raise ValidationError({
                nombre: "Usa el formato YYYY-MM-DD con una fecha válida."
            })

        fechas.append(fecha_validada)

    inicio, fin = fechas

    if inicio and fin and inicio > fin:
        raise ValidationError({
            "fecha_inicio": (
                "La fecha inicial no puede ser posterior a la fecha final."
            )
        })

    return inicio, fin


# ============================================================
# CLIENTES
# ============================================================

class ClienteListCreateView(generics.ListCreateAPIView):
    queryset = Cliente.objects.all()
    serializer_class = ClienteSerializer
    permission_classes = [IsAuthenticated]
    filter_backends = [OrderingFilter]
    ordering_fields = ["nombre"]


class ClienteResumenView(APIView):
    """
    Resumen financiero que une pedidos confirmados sin venta y ventas.

    Cada pago se cuenta una sola vez: si un pedido ya tiene venta, sus
    anticipos aparecen únicamente dentro de la venta.
    """

    permission_classes = [IsAuthenticated]

    def get(self, request):
        administrador = es_administrador(request.user)

        return Response(
            clientes_service.resumen_clientes(
                usuario=request.user,
                incluir_pedidos=administrador,
            )
        )


class ClienteResumenDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, cliente_id):
        administrador = es_administrador(request.user)
        cliente = clientes_service.resumen_cliente(
            cliente_id,
            usuario=request.user,
            incluir_pedidos=administrador,
        )

        if cliente is None:
            return Response(
                {"detail": "Cliente no encontrado."},
                status=status.HTTP_404_NOT_FOUND,
            )

        return Response(cliente)


# ============================================================
# PROVEEDORES
# ============================================================

class ProveedorListCreateView(generics.ListCreateAPIView):
    queryset = Proveedor.objects.all()
    serializer_class = ProveedorSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]


class ProveedorDetailView(generics.RetrieveUpdateAPIView):
    queryset = Proveedor.objects.all()
    serializer_class = ProveedorSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]


# ============================================================
# COMPRAS
# ============================================================

class CompraListView(generics.ListAPIView):
    serializer_class = CompraSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]
    filter_backends = [DjangoFilterBackend]
    filterset_fields = ["proveedor"]

    def get_queryset(self):
        return selectors.listar_compras(
            proveedor_id=self.request.query_params.get(
                "proveedor_id"
            ),
            fecha_inicio=self.request.query_params.get(
                "fecha_inicio"
            ),
            fecha_fin=self.request.query_params.get(
                "fecha_fin"
            ),
        )


class CompraCreateView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request):
        clave, error = _leer_idempotency_key(request)

        if error is not None:
            return error

        entrada = RegistrarCompraInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        compra = registrar_compra(
            usuario=request.user,
            clave_idempotencia=clave,
            **entrada.validated_data,
        )

        return Response(
            CompraSerializer(compra).data,
            status=status.HTTP_201_CREATED,
        )


class CompraRecepcionView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def post(self, request, compra_id):
        clave, error = _leer_idempotency_key(request)

        if error is not None:
            return error

        entrada = RegistrarRecepcionInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        registrar_recepcion(
            compra_id=compra_id,
            usuario=request.user,
            clave_idempotencia=clave,
            **entrada.validated_data,
        )

        compra = selectors.listar_compras().filter(
            pk=compra_id
        ).first()

        return Response(
            CompraSerializer(compra).data,
            status=status.HTTP_201_CREATED,
        )


# ============================================================
# VENTAS
# ============================================================

class VentaListView(generics.ListAPIView):
    serializer_class = VentaSerializer
    permission_classes = [IsAuthenticated]

    def get_queryset(self):
        administrador = es_administrador(self.request.user)

        return selectors.listar_ventas(
            cliente_id=self.request.query_params.get(
                "cliente_id"
            ),
            estado_pago=self.request.query_params.get(
                "estado_pago"
            ),
            fecha_inicio=self.request.query_params.get(
                "fecha_inicio"
            ),
            fecha_fin=self.request.query_params.get(
                "fecha_fin"
            ),
            registrado_por_id=(
                None if administrador else self.request.user.id
            ),
            con_pendientes_abastecimiento=(
                self.request.query_params.get("con_pendientes")
                in ("1", "true", "True")
            ),
        )


class VentaDetailView(APIView):
    permission_classes = [IsAuthenticated]

    def get(self, request, venta_id):
        venta = selectors.obtener_venta_detalle(venta_id)

        if venta is None:
            return Response(
                {"detail": "Venta no encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if (
            not es_administrador(request.user)
            and venta.registrado_por_id != request.user.id
        ):
            return Response(
                {"detail": "No tienes permiso para acceder a esta venta."},
                status=status.HTTP_403_FORBIDDEN,
            )

        return Response(VentaSerializer(venta).data)


class VentaCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request):
        clave_idempotencia, error = _leer_idempotency_key(
            request,
            obligatoria=False,
        )

        if error is not None:
            return error

        entrada = RegistrarVentaInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        venta = registrar_venta(
            usuario=request.user,
            clave_idempotencia=clave_idempotencia,
            **entrada.validated_data,
        )

        return Response(
            VentaSerializer(venta).data,
            status=status.HTTP_201_CREATED,
        )


# ============================================================
# ABONOS
# ============================================================

class AbonoCreateView(APIView):
    permission_classes = [IsAuthenticated]

    def post(self, request, venta_id):
        venta = (
            Venta.objects
            .filter(pk=venta_id)
            .only("id", "registrado_por_id")
            .first()
        )

        if venta is None:
            return Response(
                {"detail": "Venta no encontrada."},
                status=status.HTTP_404_NOT_FOUND,
            )

        if (
            not es_administrador(request.user)
            and venta.registrado_por_id != request.user.id
        ):
            return Response(
                {"detail": "No tienes permiso para modificar esta venta."},
                status=status.HTTP_403_FORBIDDEN,
            )

        clave_idempotencia, error = _leer_idempotency_key(
            request
        )

        if error is not None:
            return error

        entrada = RegistrarAbonoInputSerializer(
            data=request.data
        )
        entrada.is_valid(raise_exception=True)

        venta = registrar_abono(
            venta_id=venta_id,
            usuario=request.user,
            clave_idempotencia=clave_idempotencia,
            **entrada.validated_data,
        )

        return Response(
            VentaSerializer(venta).data,
            status=status.HTTP_200_OK,
        )


# ============================================================
# REPORTES FINANCIEROS — SOLO ADMINISTRADORES
# ============================================================

class ReporteDashboardView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def get(self, request):
        mes = validar_mes_reporte(
            request.query_params.get("mes")
        )

        return Response(
            reportes.resumen_dashboard(mes)
        )


class ReporteGananciaPorProductoView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def get(self, request):
        fecha_inicio, fecha_fin = validar_fechas_reporte(
            request.query_params.get("fecha_inicio"),
            request.query_params.get("fecha_fin"),
            permitir_vacias=True,
        )

        data = reportes.ganancia_por_producto(
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )

        return Response(list(data))


class ReporteResumenMensualView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def get(self, request):
        fecha_inicio, fecha_fin = validar_fechas_reporte(
            request.query_params.get("fecha_inicio"),
            request.query_params.get("fecha_fin"),
            permitir_vacias=True,
        )

        data = reportes.resumen_mensual(
            fecha_inicio=fecha_inicio,
            fecha_fin=fecha_fin,
        )

        return Response(list(data))


class ReporteBalanceView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def get(self, request):
        fecha_inicio, fecha_fin = validar_fechas_reporte(
            request.query_params.get("fecha_inicio"),
            request.query_params.get("fecha_fin"),
            permitir_vacias=False,
        )

        data = reportes.total_invertido_vs_vendido(
            fecha_inicio,
            fecha_fin,
        )

        return Response(data)


class ReporteClientesConSaldoView(APIView):
    permission_classes = [IsAuthenticated, EsAdministrador]

    def get(self, request):
        return Response(
            list(reportes.clientes_con_saldo())
        )
