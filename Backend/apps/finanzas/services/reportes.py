
from datetime import date, timedelta
from decimal import Decimal

from django.db.models import (
    DecimalField,
    ExpressionWrapper,
    F,
    Q,
    Sum,
    Value,
)
from django.db.models.functions import Coalesce, TruncMonth
from django.utils import timezone

from apps.finanzas.models import (
    Abono,
    Cliente,
    Compra,
    DetalleVenta,
    Devolucion,
    Venta,
)
from apps.finanzas.services import clientes as clientes_service
from apps.pedidos.models import Pedido


CAMPO_GANANCIA = ExpressionWrapper(
    (F("precio_venta") - F("costo_unitario"))
    * (F("cantidad") - F("cantidad_pendiente")),
    output_field=DecimalField(max_digits=14, decimal_places=2),
)

CAMPO_PAGOS = Coalesce(
    Sum("abonos__monto"),
    Value(Decimal("0.00")),
    output_field=DecimalField(max_digits=14, decimal_places=2),
)


def ganancia_por_producto(fecha_inicio=None, fecha_fin=None):
    qs = DetalleVenta.objects.select_related(
        "venta",
        "presentacion__producto",
    )

    if fecha_inicio:
        qs = qs.filter(venta__fecha__gte=fecha_inicio)

    if fecha_fin:
        qs = qs.filter(venta__fecha__lte=fecha_fin)

    return (
        qs.values(
            "presentacion__producto__id",
            "presentacion__producto__nombre",
            "presentacion__porcentaje",
        )
        .annotate(ganancia=Sum(CAMPO_GANANCIA))
        .order_by("-ganancia")
    )


def resumen_mensual(fecha_inicio=None, fecha_fin=None):
    qs = DetalleVenta.objects.all()

    if fecha_inicio:
        qs = qs.filter(venta__fecha__gte=fecha_inicio)

    if fecha_fin:
        qs = qs.filter(venta__fecha__lte=fecha_fin)

    return (
        qs.annotate(mes=TruncMonth("venta__fecha"))
        .values("mes")
        .annotate(ganancia=Sum(CAMPO_GANANCIA))
        .order_by("mes")
    )


def total_invertido_vs_vendido(fecha_inicio, fecha_fin):
    invertido = (
        Compra.objects.filter(
            fecha__gte=fecha_inicio,
            fecha__lte=fecha_fin,
        ).aggregate(total=Sum("total"))["total"]
        or Decimal("0.00")
    )

    vendido = (
        Venta.objects.filter(
            fecha__gte=fecha_inicio,
            fecha__lte=fecha_fin,
        ).aggregate(total=Sum("total"))["total"]
        or Decimal("0.00")
    )

    return {
        "invertido": invertido,
        "vendido": vendido,
        "balance": vendido - invertido,
    }


def clientes_con_saldo():
    return clientes_service.clientes_con_saldo()


def _periodo_mes(mes):
    anio, numero_mes = map(int, str(mes).split("-"))
    inicio = date(anio, numero_mes, 1)

    if numero_mes == 12:
        fin = date(anio + 1, 1, 1)
    else:
        fin = date(anio, numero_mes + 1, 1)

    return inicio, fin


def _sumar_meses(fecha, cantidad):
    total_meses = fecha.year * 12 + (fecha.month - 1) + cantidad
    return date(total_meses // 12, total_meses % 12 + 1, 1)


def _meses_serie(fecha_fin_exclusiva, cantidad=6):
    inicio_ultimo_mes = date(
        fecha_fin_exclusiva.year,
        fecha_fin_exclusiva.month,
        1,
    )
    primer_mes = _sumar_meses(
        inicio_ultimo_mes,
        -(cantidad - 1),
    )

    return [
        _sumar_meses(primer_mes, indice)
        for indice in range(cantidad)
    ]


def _numero(valor):
    return float(valor or Decimal("0.00"))


def _productos_periodo(inicio, fin):
    return list(
        DetalleVenta.objects
        .filter(
            venta__fecha__gte=inicio,
            venta__fecha__lt=fin,
        )
        .values(
            "presentacion__producto__id",
            "presentacion__producto__nombre",
        )
        .annotate(
            unidades=Sum("cantidad"),
            ganancia=Sum(CAMPO_GANANCIA),
        )
    )


def _total_vendido(inicio, fin):
    return (
        Venta.objects
        .filter(fecha__gte=inicio, fecha__lt=fin)
        .aggregate(total=Sum("total"))["total"]
        or Decimal("0.00")
    )


def _resumen_clientes_con_saldo():
    resumen = clientes_service.resumen_clientes()

    return {
        "total": sum(
            (
                Decimal(cliente["saldo_pendiente"])
                for cliente in resumen
            ),
            Decimal("0.00"),
        ),
        "clientes": sum(
            1
            for cliente in resumen
            if Decimal(cliente["saldo_pendiente"]) > 0
        ),
    }


def _resumen_pedidos_por_comprar():
    """
    Cuenta pedidos con al menos una unidad pendiente de recibir.

    Los pedidos nuevos usan `por_comprar`; `confirmado` se conserva
    para datos históricos creados antes de separar ambos estados.
    """

    pedidos = (
        Pedido.objects
        .filter(
            estado__in=[
                Pedido.Estado.POR_COMPRAR,
                Pedido.Estado.CONFIRMADO,
            ],
            venta__isnull=True,
        )
        .prefetch_related("abonos", "detalles")
    )

    saldo = Decimal("0.00")
    cantidad = 0

    for pedido in pedidos:
        detalles = list(pedido.detalles.all())

        if detalles and not any(
            detalle.cantidad_pendiente > 0
            for detalle in detalles
        ):
            continue

        anticipos = sum(
            (
                abono.monto
                for abono in pedido.abonos.all()
                if abono.venta_id is None
            ),
            Decimal("0.00"),
        )
        pendiente = max(
            (pedido.total or Decimal("0.00")) - anticipos,
            Decimal("0.00"),
        )

        cantidad += 1
        saldo += pendiente

    return {
        "cantidad": cantidad,
        "saldo": saldo,
    }


def _ventas_relevantes_para_recaudacion(inicio, fin):
    abonos_en_periodo = Abono.objects.filter(
        fecha__gte=inicio,
        fecha__lt=fin,
    ).values("venta_id")

    return Venta.objects.filter(
        Q(fecha__lt=fin) | Q(pk__in=abonos_en_periodo)
    )


def _hay_ventas_inconsistentes(inicio, fin):
    ventas = _ventas_relevantes_para_recaudacion(
        inicio,
        fin,
    ).annotate(pagos=CAMPO_PAGOS)

    estado_pendiente_invalido = (
        Q(estado_pago=Venta.EstadoPago.PENDIENTE)
        & ~Q(saldo=F("total"))
    )
    estado_pagado_invalido = (
        Q(estado_pago=Venta.EstadoPago.PAGADO)
        & ~Q(saldo=0)
    )
    estado_abonado_invalido = (
        Q(estado_pago=Venta.EstadoPago.ABONADO)
        & (
            ~Q(saldo__gt=0)
            | ~Q(saldo__lt=F("total"))
            | ~Q(pagos__gt=0)
        )
    )

    return ventas.filter(
        Q(saldo__lt=0)
        | Q(saldo__gt=F("total"))
        | ~Q(pagos=F("total") - F("saldo"))
        | estado_pendiente_invalido
        | estado_pagado_invalido
        | estado_abonado_invalido
    ).exists()


def recaudacion_periodo(inicio, fin):
    """
    Devuelve la recaudación solo cuando el periodo puede certificarse.

    La verificación es deliberadamente conservadora: si una venta
    anterior al cierre del periodo tiene pagos no registrados o
    invariantes inconsistentes, el periodo no se marca como disponible.
    No se reconstruyen pagos históricos.
    """

    if _hay_ventas_inconsistentes(inicio, fin):
        return {
            "disponible": False,
            "importe": None,
            "devoluciones": None,
            "motivo": (
                "La recaudación no se puede certificar porque existen "
                "ventas con pagos no registrados o datos inconsistentes."
            ),
        }

    abonos = Abono.objects.filter(
        fecha__gte=inicio,
        fecha__lt=fin,
    )
    devoluciones = Devolucion.objects.filter(
        fecha__gte=inicio,
        fecha__lt=fin,
    )

    if abonos.filter(
        Q(monto__lte=0)
        | Q(fecha__gt=timezone.localdate())
    ).exists():
        return {
            "disponible": False,
            "importe": None,
            "devoluciones": None,
            "motivo": (
                "La recaudación no se puede certificar porque hay "
                "pagos con datos inválidos en el periodo."
            ),
        }

    if devoluciones.filter(
        Q(monto__lte=0)
        | Q(fecha__gt=timezone.localdate())
    ).exists():
        return {
            "disponible": False,
            "importe": None,
            "devoluciones": None,
            "motivo": (
                "La recaudación no se puede certificar porque hay "
                "devoluciones con datos inválidos en el periodo."
            ),
        }

    total_abonos = (
        abonos.aggregate(total=Sum("monto"))["total"]
        or Decimal("0.00")
    )
    total_devoluciones = (
        devoluciones.aggregate(total=Sum("monto"))["total"]
        or Decimal("0.00")
    )
    total = total_abonos - total_devoluciones

    return {
        "disponible": True,
        "importe": _numero(total),
        "devoluciones": _numero(total_devoluciones),
        "motivo": None,
    }


def _unidades_y_ganancias_por_producto(inicio, fin):
    filas = _productos_periodo(inicio, fin)

    unidades = sorted(
        [
            {
                "producto_id": fila["presentacion__producto__id"],
                "producto_nombre": fila[
                    "presentacion__producto__nombre"
                ],
                "unidades": int(fila["unidades"] or 0),
            }
            for fila in filas
        ],
        key=lambda fila: (
            -fila["unidades"],
            fila["producto_nombre"],
            fila["producto_id"],
        ),
    )

    ganancias = sorted(
        [
            {
                "producto_id": fila["presentacion__producto__id"],
                "producto_nombre": fila[
                    "presentacion__producto__nombre"
                ],
                "ganancia": _numero(fila["ganancia"]),
            }
            for fila in filas
        ],
        key=lambda fila: (
            -fila["ganancia"],
            fila["producto_nombre"],
            fila["producto_id"],
        ),
    )

    ganancia_bruta = sum(
        (fila["ganancia"] or Decimal("0.00"))
        for fila in filas
    )

    return {
        "ganancia_bruta": _numero(ganancia_bruta),
        "unidades_por_producto": unidades,
        "ganancia_por_producto": ganancias,
    }


def _ganancias_mensuales(fecha_fin_exclusiva):
    ultimo_dia = fecha_fin_exclusiva - timedelta(days=1)
    meses = _meses_serie(ultimo_dia, 6)
    inicio_serie = meses[0]
    filas = resumen_mensual(
        fecha_inicio=inicio_serie,
        fecha_fin=ultimo_dia,
    )
    por_mes = {
        fila["mes"].strftime("%Y-%m"): fila["ganancia"]
        for fila in filas
    }

    return [
        {
            "mes": fecha.strftime("%Y-%m"),
            "ganancia": _numero(
                por_mes.get(fecha.strftime("%Y-%m"))
            ),
        }
        for fecha in meses
    ]


def _pedidos_recientes():
    pedidos = (
        Pedido.objects
        .select_related("cliente")
        .order_by("-creado_en")[:5]
    )

    return [
        {
            "id": pedido.id,
            "cliente_nombre": pedido.cliente.nombre,
            "total": _numero(pedido.total),
            "estado": pedido.estado,
            "creado_en": pedido.creado_en.isoformat(),
        }
        for pedido in pedidos
    ]


def resumen_dashboard(mes):
    inicio, fin = _periodo_mes(mes)
    productos = _unidades_y_ganancias_por_producto(
        inicio,
        fin,
    )
    saldo = _resumen_clientes_con_saldo()
    pedidos_por_comprar = _resumen_pedidos_por_comprar()
    recaudacion = recaudacion_periodo(inicio, fin)

    return {
        "periodo": {
            "mes": mes,
            "fecha_inicio": inicio.isoformat(),
            "fecha_fin_exclusiva": fin.isoformat(),
        },
        "moneda": "COP",
        "metricas_periodo": {
            "ganancia_bruta": productos["ganancia_bruta"],
            "total_vendido": _numero(
                _total_vendido(inicio, fin)
            ),
            "recaudacion": recaudacion,
            "devoluciones": recaudacion["devoluciones"],
            "unidades_por_producto": productos[
                "unidades_por_producto"
            ],
            "ganancia_por_producto": productos[
                "ganancia_por_producto"
            ],
            "ganancias_mensuales": _ganancias_mensuales(fin),
        },
        "metricas_actuales": {
            "saldo_por_cobrar": _numero(saldo["total"]),
            "clientes_con_deudas": int(saldo["clientes"] or 0),
            "clientes_registrados": Cliente.objects.count(),
            "pedidos_pendientes": Pedido.objects.filter(
                estado=Pedido.Estado.PENDIENTE
            ).count(),
            "pedidos_por_comprar": pedidos_por_comprar["cantidad"],
            "saldo_pedidos_por_comprar": _numero(
                pedidos_por_comprar["saldo"]
            ),
            "pedidos_confirmados_sin_venta": Pedido.objects.filter(
                estado__in=[
                    Pedido.Estado.CONFIRMADO,
                    Pedido.Estado.POR_COMPRAR,
                ],
                venta__isnull=True,
            ).count(),
        },
        "pedidos_recientes": _pedidos_recientes(),
    }
