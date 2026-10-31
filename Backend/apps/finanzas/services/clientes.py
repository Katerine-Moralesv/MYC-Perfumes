from decimal import Decimal

from django.db.models import Prefetch

from apps.finanzas.models import Abono, Cliente, Venta
from apps.pedidos.models import Pedido
from apps.usuarios.permissions import es_administrador


ESTADOS_COMPROMISO = {
    Pedido.Estado.CONFIRMADO,
    Pedido.Estado.POR_COMPRAR,
    Pedido.Estado.COMPRADO,
    Pedido.Estado.PREPARANDO,
    Pedido.Estado.LISTO,
}

ESTADOS_SIN_DEUDA = {
    Pedido.Estado.PENDIENTE,
    Pedido.Estado.CANCELADO,
    Pedido.Estado.RECHAZADO,
    Pedido.Estado.ENTREGADO,
}


def _decimal(valor):
    return Decimal(str(valor or "0"))


def _resumen_detalle_pedido(detalle):
    producto = detalle.producto

    if producto is None and detalle.presentacion_id:
        producto = detalle.presentacion.producto

    return {
        "id": detalle.id,
        "producto_nombre": producto.nombre if producto else "Producto",
        "porcentaje": detalle.porcentaje_recarga,
        "cantidad": detalle.cantidad,
        "cantidad_cubierta": detalle.cantidad_recibida,
        "cantidad_pendiente": detalle.cantidad_pendiente,
        "precio_unitario": str(detalle.precio_unitario),
        "precio_pendiente": detalle.precio_pendiente,
        "subtotal": str(detalle.subtotal),
    }


def _resumen_abono(abono):
    return {
        "id": abono.id,
        "monto": str(abono.monto),
        "fecha": abono.fecha.isoformat(),
        "tipo": abono.tipo or "",
        "metodo_pago": abono.metodo_pago or "",
        "referencia": abono.referencia or "",
        "venta_id": abono.venta_id,
        "pedido_id": abono.pedido_id,
    }


def _estado_pago(total, pagado):
    if pagado <= 0:
        return "pendiente"

    if pagado >= total:
        return "pagado"

    return "abonado"


def _resumen_pedido(pedido):
    abonos = [
        abono
        for abono in pedido.abonos.all()
        if abono.venta_id is None
    ]
    pagado = sum(
        (_decimal(abono.monto) for abono in abonos),
        Decimal("0.00"),
    )
    total = _decimal(pedido.total)
    saldo = max(total - pagado, Decimal("0.00"))
    detalles = list(pedido.detalles.all())

    return {
        "id": pedido.id,
        "estado": pedido.estado,
        "total": str(total),
        "monto_pagado": str(pagado),
        "saldo": str(saldo),
        "estado_pago": _estado_pago(total, pagado),
        "precios_completos": bool(detalles) and all(
            not detalle.precio_pendiente
            for detalle in detalles
        ),
        "unidades_pendientes_compra": sum(
            detalle.cantidad_pendiente
            for detalle in detalles
        ),
        "creado_en": pedido.creado_en.isoformat(),
        "venta": None,
        "anticipos": [_resumen_abono(abono) for abono in abonos],
        "detalles": [
            _resumen_detalle_pedido(detalle)
            for detalle in detalles
        ],
    }


def _resumen_venta(venta):
    abonos = list(venta.abonos.all())
    pagado = sum(
        (_decimal(abono.monto) for abono in abonos),
        Decimal("0.00"),
    )
    total = _decimal(venta.total)
    saldo = max(_decimal(venta.saldo), Decimal("0.00"))
    pedido_origen = getattr(venta, "pedido_origen", None)

    return {
        "id": venta.id,
        "fecha": venta.fecha.isoformat(),
        "total": str(total),
        "monto_pagado": str(pagado),
        "saldo": str(saldo),
        "estado_pago": venta.estado_pago,
        "estado_abastecimiento": venta.estado_abastecimiento,
        "unidades_pendientes_abastecimiento": (
            venta.unidades_pendientes_abastecimiento
        ),
        "pedido_origen": (
            pedido_origen.id if pedido_origen else None
        ),
        "abonos": [_resumen_abono(abono) for abono in abonos],
        "detalles": [
            {
                "id": detalle.id,
                "producto_nombre": (
                    detalle.presentacion.producto.nombre
                ),
                "porcentaje": detalle.presentacion.porcentaje,
                "cantidad": detalle.cantidad,
                "cantidad_cubierta": detalle.cantidad_cubierta,
                "cantidad_pendiente": detalle.cantidad_pendiente,
                "precio_venta": str(detalle.precio_venta),
                "costo_unitario": str(detalle.costo_unitario),
                "subtotal": str(detalle.subtotal),
            }
            for detalle in venta.detalles.all()
        ],
    }


def _consultas(usuario, incluir_pedidos):
    ventas = (
        Venta.objects
        .select_related("cliente", "pedido_origen")
        .prefetch_related(
            "abonos",
            "detalles__presentacion__producto",
        )
        .exclude(
            pedido_origen__estado__in=[
                Pedido.Estado.CANCELADO,
                Pedido.Estado.RECHAZADO,
            ]
        )
        .order_by("-fecha", "-id")
    )

    if usuario is not None and not es_administrador(usuario):
        ventas = ventas.filter(registrado_por=usuario)

    pedidos = Pedido.objects.none()

    if incluir_pedidos:
        pedidos = (
            Pedido.objects
            .select_related("cliente", "venta")
            .prefetch_related(
                Prefetch(
                    "abonos",
                    queryset=Abono.objects.filter(
                        venta__isnull=True
                    ).order_by("-fecha", "-id"),
                ),
                "detalles__producto",
                "detalles__presentacion__producto",
            )
            .filter(
                venta__isnull=True,
            )
            .exclude(estado__in=ESTADOS_SIN_DEUDA)
            .order_by("-creado_en", "-id")
        )

    return ventas, pedidos


def _estado_cliente(*, ventas, pedidos, saldo):
    if any(
        pedido["estado"] == Pedido.Estado.POR_COMPRAR
        for pedido in pedidos
    ):
        return "Por comprar"

    if saldo <= 0:
        if ventas or pedidos:
            return "Al día"
        return "Sin movimientos"

    if sum(
        (
            _decimal(venta["monto_pagado"])
            for venta in ventas
        ),
        Decimal("0.00"),
    ) + sum(
        (
            _decimal(pedido["monto_pagado"])
            for pedido in pedidos
        ),
        Decimal("0.00"),
    ) > 0:
        return "Abonado"

    return "Pendiente"


def _armar_cliente(cliente, ventas, pedidos):
    ventas_cliente = [
        _resumen_venta(venta)
        for venta in ventas
        if venta.cliente_id == cliente.id
    ]
    pedidos_cliente = [
        _resumen_pedido(pedido)
        for pedido in pedidos
        if pedido.cliente_id == cliente.id
    ]

    total_ventas = sum(
        (_decimal(venta["total"]) for venta in ventas_cliente),
        Decimal("0.00"),
    )
    total_pedidos = sum(
        (_decimal(pedido["total"]) for pedido in pedidos_cliente),
        Decimal("0.00"),
    )
    total_pagado = sum(
        (_decimal(venta["monto_pagado"]) for venta in ventas_cliente),
        Decimal("0.00"),
    ) + sum(
        (
            _decimal(pedido["monto_pagado"])
            for pedido in pedidos_cliente
        ),
        Decimal("0.00"),
    )
    saldo = sum(
        (_decimal(venta["saldo"]) for venta in ventas_cliente),
        Decimal("0.00"),
    ) + sum(
        (_decimal(pedido["saldo"]) for pedido in pedidos_cliente),
        Decimal("0.00"),
    )

    return {
        "id": cliente.id,
        "nombre": cliente.nombre,
        "telefono": cliente.telefono,
        "notas": cliente.notas,
        "ventas": ventas_cliente,
        "pedidos": pedidos_cliente,
        "total_ventas": str(total_ventas),
        "total_pedidos": str(total_pedidos),
        "total_acordado": str(total_ventas + total_pedidos),
        "total_pagado": str(total_pagado),
        "saldo_pendiente": str(saldo),
        "estado": _estado_cliente(
            ventas=ventas_cliente,
            pedidos=pedidos_cliente,
            saldo=saldo,
        ),
    }


def resumen_clientes(*, usuario=None, incluir_pedidos=True):
    ventas, pedidos = _consultas(usuario, incluir_pedidos)
    ventas = list(ventas)
    pedidos = list(pedidos)

    clientes = list(Cliente.objects.all().order_by("nombre", "id"))

    return [
        _armar_cliente(cliente, ventas, pedidos)
        for cliente in clientes
    ]


def clientes_con_saldo(*, usuario=None, incluir_pedidos=True):
    return [
        {
            "cliente__id": cliente["id"],
            "cliente__nombre": cliente["nombre"],
            "deuda_total": _decimal(cliente["saldo_pendiente"]),
            "cliente_id": cliente["id"],
            "cliente_nombre": cliente["nombre"],
            "saldo_pendiente": cliente["saldo_pendiente"],
        }
        for cliente in resumen_clientes(
            usuario=usuario,
            incluir_pedidos=incluir_pedidos,
        )
        if _decimal(cliente["saldo_pendiente"]) > 0
    ]


def resumen_cliente(cliente_id, *, usuario=None, incluir_pedidos=True):
    for cliente in resumen_clientes(
        usuario=usuario,
        incluir_pedidos=incluir_pedidos,
    ):
        if cliente["id"] == cliente_id:
            return cliente

    return None
