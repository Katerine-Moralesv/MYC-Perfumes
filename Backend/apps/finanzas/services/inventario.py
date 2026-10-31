from decimal import Decimal

from django.db.models import Sum
from django.utils import timezone

from apps.core.exceptions import ReglaNegocioError
from apps.finanzas.models import (
    AsignacionCompraPedido,
    DetalleCompra,
    DetalleVenta,
)
from apps.pedidos.models import Pedido


ESTADOS_SIN_RESERVA = {
    Pedido.Estado.CANCELADO,
    Pedido.Estado.RECHAZADO,
}


def producto_de_detalle(detalle):
    if detalle.producto_id:
        return detalle.producto

    if detalle.presentacion_id:
        return detalle.presentacion.producto

    return None


def _reservas_por_lote(producto_id, porcentaje=None):
    qs = (
        AsignacionCompraPedido.objects
        .filter(
            detalle_compra__presentacion__producto_id=producto_id,
            liberada_en__isnull=True,
            detalle_pedido__pedido__venta__isnull=True,
        )
        .exclude(detalle_pedido__pedido__estado__in=ESTADOS_SIN_RESERVA)
    )

    if porcentaje is not None:
        qs = qs.filter(
            detalle_compra__presentacion__porcentaje=porcentaje,
        )

    return {
        fila["detalle_compra_id"]: fila["total"]
        for fila in (
            qs.values("detalle_compra_id")
            .annotate(total=Sum("cantidad"))
        )
    }


def _unidades_vendidas(producto_id, porcentaje=None):
    qs = DetalleVenta.objects.filter(
        presentacion__producto_id=producto_id,
    )

    if porcentaje is not None:
        qs = qs.filter(
            presentacion__porcentaje=porcentaje,
        )

    fila = qs.aggregate(
        total=Sum("cantidad"),
        pendiente=Sum("cantidad_pendiente"),
    )

    return (
        (fila["total"] or 0)
        - (fila["pendiente"] or 0)
    )


def _lotes(producto_id, porcentaje=None, *, bloquear=False):
    qs = (
        DetalleCompra.objects
        .select_related("presentacion", "compra")
        .filter(
            presentacion__producto_id=producto_id,
            cantidad_recibida__gt=0,
        )
        .order_by("compra__fecha", "compra_id", "id")
    )

    if porcentaje is not None:
        qs = qs.filter(
            presentacion__porcentaje=porcentaje,
        )

    if bloquear:
        qs = qs.select_for_update()

    return list(qs)


def _lotes_disponibles(
    producto_id,
    porcentaje=None,
    *,
    bloquear=False,
):
    """
    Devuelve los lotes con existencia libre después de descontar:

    - reservas activas de pedidos todavía no vendidos;
    - unidades ya vendidas, aplicadas FIFO sobre lo no reservado.

    Las asignaciones de pedidos con venta no se descuentan como reserva
    porque la venta ya descuenta esas unidades una sola vez.
    """

    lotes = _lotes(
        producto_id,
        porcentaje,
        bloquear=bloquear,
    )
    reservas = _reservas_por_lote(producto_id, porcentaje)
    vendidas_pendientes = _unidades_vendidas(
        producto_id,
        porcentaje,
    )
    disponibles = []

    for lote in lotes:
        libre = max(
            lote.cantidad_recibida - reservas.get(lote.id, 0),
            0,
        )

        if libre <= 0:
            continue

        if vendidas_pendientes > 0:
            consumidas = min(libre, vendidas_pendientes)
            libre -= consumidas
            vendidas_pendientes -= consumidas

        if libre > 0:
            disponibles.append((lote, libre))

    return disponibles


def disponibilidad_producto(producto_id, porcentaje=None):
    recibidas = sum(
        lote.cantidad_recibida
        for lote in _lotes(producto_id, porcentaje)
    )
    vendidas = _unidades_vendidas(producto_id, porcentaje)
    reservadas = sum(
        _reservas_por_lote(producto_id, porcentaje).values()
    )
    fisicas = max(recibidas - vendidas, 0)
    disponibles = max(fisicas - reservadas, 0)

    return {
        "producto_id": producto_id,
        "porcentaje": porcentaje,
        "recibidas": recibidas,
        "fisicas": fisicas,
        "reservadas": reservadas,
        "vendidas": vendidas,
        "disponibles": disponibles,
    }


def disponibilidad_por_productos(producto_ids):
    return {
        producto_id: disponibilidad_producto(producto_id)
        for producto_id in set(producto_ids)
    }


def aplicar_cobertura_linea(
    *,
    detalle_pedido,
    cantidad,
    costo_unitario,
):
    if cantidad <= 0:
        return detalle_pedido

    pendiente = detalle_pedido.cantidad_pendiente

    if cantidad > pendiente:
        raise ReglaNegocioError(
            "La cantidad recibida supera lo pendiente de la línea "
            "del pedido."
        )

    cantidad_anterior = detalle_pedido.cantidad_recibida
    costo_anterior = detalle_pedido.costo_unitario_real

    if cantidad_anterior > 0 and costo_anterior is not None:
        valor_anterior = costo_anterior * cantidad_anterior
        valor_nuevo = costo_unitario * cantidad
        cantidad_total = cantidad_anterior + cantidad
        costo_final = (
            (valor_anterior + valor_nuevo) / cantidad_total
        ).quantize(Decimal("0.01"))
    else:
        costo_final = costo_unitario

    detalle_pedido.cantidad_recibida = cantidad_anterior + cantidad
    detalle_pedido.costo_unitario_real = costo_final
    detalle_pedido.save(
        update_fields=[
            "cantidad_recibida",
            "costo_unitario_real",
        ]
    )

    return detalle_pedido


def reservar_para_detalle(
    *,
    detalle_pedido,
    usuario,
    cantidad=None,
):
    pedido = detalle_pedido.pedido

    if pedido.venta_id or pedido.estado in ESTADOS_SIN_RESERVA:
        return 0

    producto = producto_de_detalle(detalle_pedido)

    if producto is None:
        raise ReglaNegocioError(
            "La línea del pedido no tiene un producto físico definido."
        )

    faltante = (
        detalle_pedido.cantidad_pendiente
        if cantidad is None
        else min(cantidad, detalle_pedido.cantidad_pendiente)
    )

    if faltante <= 0:
        return 0

    reservado = 0

    for lote, libre in _lotes_disponibles(
        producto.id,
        detalle_pedido.porcentaje_recarga,
        bloquear=True,
    ):
        if faltante <= 0:
            break

        tomar = min(faltante, libre)

        asignacion = (
            AsignacionCompraPedido.objects
            .select_for_update()
            .filter(
                detalle_compra=lote,
                detalle_pedido=detalle_pedido,
                liberada_en__isnull=True,
            )
            .first()
        )

        if asignacion is None:
            asignacion = AsignacionCompraPedido.objects.create(
                detalle_compra=lote,
                detalle_pedido=detalle_pedido,
                cantidad=tomar,
                costo_unitario=lote.costo_unitario,
                registrado_por=usuario,
            )
        else:
            asignacion.cantidad += tomar
            asignacion.costo_unitario = lote.costo_unitario
            asignacion.save(
                update_fields=[
                    "cantidad",
                    "costo_unitario",
                    "actualizado_en",
                ]
            )

        aplicar_cobertura_linea(
            detalle_pedido=detalle_pedido,
            cantidad=tomar,
            costo_unitario=lote.costo_unitario,
        )

        faltante -= tomar
        reservado += tomar

    return reservado


def reservar_stock_pedido(pedido, usuario):
    pendiente_total = 0
    reservado_total = 0

    for detalle in pedido.detalles.select_for_update().all():
        reservado = reservar_para_detalle(
            detalle_pedido=detalle,
            usuario=usuario,
        )
        reservado_total += reservado
        pendiente_total += detalle.cantidad_pendiente

    return {
        "reservado": reservado_total,
        "pendiente": pendiente_total,
    }


def asignar_stock_para_venta(lineas):
    """
    Distribuye FIFO las existencias libres entre las líneas de una venta.

    No falla si falta stock: devuelve cuánto quedó cubierto y cuánto
    queda pendiente de abastecimiento. El costo es el promedio
    ponderado de los lotes efectivamente asignados.
    """

    disponibles = {}
    resultados = []

    for linea in lineas:
        presentacion = linea["presentacion"]
        clave = (
            presentacion.producto_id,
            presentacion.porcentaje,
        )

        if clave not in disponibles:
            disponibles[clave] = [
                [lote, libre]
                for lote, libre in _lotes_disponibles(
                    clave[0],
                    clave[1],
                    bloquear=True,
                )
            ]

        faltante = int(linea["cantidad"])
        cubierta = 0
        valor = Decimal("0.00")

        for item in disponibles[clave]:
            if faltante <= 0:
                break

            lote, libre = item
            tomar = min(faltante, libre)

            if tomar <= 0:
                continue

            valor += lote.costo_unitario * tomar
            cubierta += tomar
            faltante -= tomar
            item[1] -= tomar

        costo_unitario = (
            (valor / cubierta).quantize(Decimal("0.01"))
            if cubierta > 0
            else Decimal("0.00")
        )

        resultados.append({
            **linea,
            "cantidad_cubierta": cubierta,
            "cantidad_pendiente": int(linea["cantidad"]) - cubierta,
            "costo_unitario": costo_unitario,
        })

    return resultados


def liberar_reservas_pedido(pedido, usuario):
    if pedido.venta_id:
        return 0

    ahora = timezone.now()
    asignaciones = list(
        AsignacionCompraPedido.objects
        .select_for_update()
        .filter(
            detalle_pedido__pedido=pedido,
            liberada_en__isnull=True,
        )
    )

    for asignacion in asignaciones:
        asignacion.liberada_en = ahora
        asignacion.liberada_por = usuario
        asignacion.save(
            update_fields=[
                "liberada_en",
                "liberada_por",
                "actualizado_en",
            ]
        )

    return len(asignaciones)


def costear_stock_manual(producto_id, cantidad, porcentaje=None):
    """
    Valida disponibilidad y devuelve el costo FIFO ponderado de las
    unidades que consumiría una venta manual.
    """

    faltante = int(cantidad)

    if faltante <= 0:
        raise ReglaNegocioError(
            "La cantidad debe ser mayor a cero."
        )

    valor_total = Decimal("0.00")
    unidades = 0

    for lote, libre in _lotes_disponibles(
        producto_id,
        porcentaje,
        bloquear=True,
    ):
        if faltante <= 0:
            break

        tomar = min(faltante, libre)
        valor_total += lote.costo_unitario * tomar
        unidades += tomar
        faltante -= tomar

    if faltante > 0:
        raise ReglaNegocioError(
            "No hay existencias disponibles suficientes para completar "
            "la venta."
        )

    return (valor_total / unidades).quantize(Decimal("0.01"))


def costos_stock_para_lineas(lineas):
    """
    Calcula un único costo FIFO por producto para todas las líneas de
    una venta manual, evitando consumir dos veces el mismo stock dentro
    de la misma operación.
    """

    cantidades = {}

    for linea in lineas:
        presentacion = linea["presentacion"]
        clave = (
            presentacion.producto_id,
            presentacion.porcentaje,
        )
        cantidades[clave] = (
            cantidades.get(clave, 0) + int(linea["cantidad"])
        )

    costos = {
        clave: costear_stock_manual(
            clave[0],
            cantidades[clave],
            clave[1],
        )
        for clave in sorted(cantidades)
    }

    return {
        (
            linea["presentacion"].producto_id,
            linea["presentacion"].porcentaje,
        ): costos[
            (
                linea["presentacion"].producto_id,
                linea["presentacion"].porcentaje,
            )
        ]
        for linea in lineas
    }
