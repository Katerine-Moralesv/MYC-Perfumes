from decimal import Decimal, InvalidOperation

from django.db import transaction

from apps.core.exceptions import ReglaNegocioError
from apps.finanzas.models import Venta
from apps.finanzas.services.inventario import reservar_stock_pedido
from apps.pedidos.models import Pedido
from apps.pedidos.repositories import obtener_pedido_pendiente
from apps.pedidos.services.anticipos import registrar_anticipo
from apps.pedidos.services.cierre import (
    finalizar_abastecimiento_pedido,
)
from apps.pedidos.services.historial import registrar_transicion


def _obtener_monto_recibido(valor):
    if valor in (None, ""):
        return Decimal("0.00")

    try:
        monto = Decimal(str(valor))
    except (InvalidOperation, TypeError, ValueError):
        raise ReglaNegocioError(
            "El monto recibido no es válido."
        )

    if not monto.is_finite() or monto < 0:
        raise ReglaNegocioError(
            "El monto recibido debe ser un valor válido y no negativo."
        )

    return monto


def _obtener_detalles(pedido):
    return list(
        pedido.detalles
        .select_related(
            "producto",
            "presentacion__producto",
        )
        .all()
    )


def _calcular_total(detalles):
    return sum(
        (
            detalle.precio_unitario * detalle.cantidad
            for detalle in detalles
        ),
        Decimal("0.00"),
    )


def _validar_pago(
    *,
    estado_pago,
    monto_recibido,
    total,
):
    if estado_pago not in Venta.EstadoPago.values:
        raise ReglaNegocioError(
            "Estado de pago inválido."
        )

    monto_proporcionado = monto_recibido is not None
    monto = _obtener_monto_recibido(monto_recibido)

    if estado_pago == Venta.EstadoPago.PENDIENTE:
        if monto_proporcionado and monto != 0:
            raise ReglaNegocioError(
                "Si la clienta no ha pagado, el monto recibido "
                "debe ser cero."
            )

        return Decimal("0.00")

    if estado_pago == Venta.EstadoPago.ABONADO:
        if not monto_proporcionado or monto <= 0:
            raise ReglaNegocioError(
                "Debes indicar el monto recibido para el abono."
            )

        if monto >= total:
            raise ReglaNegocioError(
                "El abono debe ser menor que el total. "
                "Para un pago completo usa estado_pago='pagado'."
            )

        return monto

    # Venta.EstadoPago.PAGADO
    if monto_proporcionado:
        if monto <= 0:
            raise ReglaNegocioError(
                "Si el pago es total, el monto recibido debe ser "
                "mayor a cero."
            )

        if monto != total:
            raise ReglaNegocioError(
                "Para un pago total, el monto recibido debe "
                "coincidir con el total del pedido."
            )

        return monto

    # El administrador seleccionó explícitamente "pagado". Si no
    # envía monto, se entiende que recibió el total del pedido.
    return total


def _aplicar_precios_pendientes(pedido, lineas_precio):
    """
    Persiste los precios finales de las recargas 60/70/80.

    Es una operación idempotente. Mientras el pedido siga pendiente,
    el administrador puede reenviar el mismo precio o corregirlo.
    Las líneas sin recarga (40%) nunca se modifican en esta fase.
    """

    detalles = _obtener_detalles(pedido)

    if not detalles:
        raise ReglaNegocioError(
            "El pedido no contiene productos."
        )

    detalles_por_id = {
        detalle.id: detalle
        for detalle in detalles
    }

    detalles_por_presentacion = {
        detalle.presentacion_id: detalle
        for detalle in detalles
        if detalle.presentacion_id is not None
    }

    precios_por_detalle = {}

    for linea in lineas_precio or []:
        detalle_id = linea.get("detalle_id")
        presentacion_id = linea.get("presentacion_id")

        if detalle_id is not None:
            detalle = detalles_por_id.get(detalle_id)

            if detalle is None:
                raise ReglaNegocioError(
                    "Se recibió un precio para una línea que no "
                    "pertenece al pedido."
                )

            if (
                presentacion_id is not None
                and detalle.presentacion_id != presentacion_id
            ):
                raise ReglaNegocioError(
                    "La presentación no coincide con la línea indicada."
                )
        elif presentacion_id is not None:
            detalle = detalles_por_presentacion.get(presentacion_id)

            if detalle is None:
                raise ReglaNegocioError(
                    "Se recibió un precio para una presentación "
                    "que no pertenece al pedido."
                )
        else:
            raise ReglaNegocioError(
                "Debes indicar detalle_id o presentacion_id."
            )

        if detalle.id in precios_por_detalle:
            raise ReglaNegocioError(
                "No se puede repetir una línea en los precios."
            )

        try:
            precio = Decimal(str(linea["precio_venta"]))
        except (InvalidOperation, TypeError, ValueError):
            raise ReglaNegocioError(
                "El precio de venta no es válido."
            )

        if not precio.is_finite() or precio <= 0:
            raise ReglaNegocioError(
                "El precio de venta debe ser mayor a cero."
            )

        precios_por_detalle[detalle.id] = precio

    ids_pendientes = {
        detalle.id
        for detalle in detalles
        if detalle.precio_pendiente
    }

    for detalle_id in precios_por_detalle:
        detalle = detalles_por_id[detalle_id]

        if detalle.precio_pendiente:
            continue

        if detalle.recarga_solicitada:
            # El pedido sigue pendiente: se permite corregir el
            # precio de una recarga ya guardada.
            continue

        raise ReglaNegocioError(
            "Solo se puede definir o corregir el precio de las "
            "recargas. Las líneas sin recarga conservan el precio "
            "guardado al crear el pedido."
        )

    if ids_pendientes - set(precios_por_detalle):
        raise ReglaNegocioError(
            "Faltan precios para las recargas pendientes del pedido."
        )

    for detalle in detalles:
        if detalle.cantidad <= 0:
            raise ReglaNegocioError(
                "La cantidad debe ser mayor a cero."
            )

        if (
            detalle.precio_pendiente
            or detalle.id in precios_por_detalle
        ):
            detalle.precio_unitario = precios_por_detalle[
                detalle.id
            ]
            detalle.precio_pendiente = False

            detalle.save(
                update_fields=[
                    "precio_unitario",
                    "precio_pendiente",
                ]
            )

        if detalle.precio_unitario <= 0:
            raise ReglaNegocioError(
                "Todas las líneas del pedido deben tener un "
                "precio final mayor a cero."
            )

    total = _calcular_total(detalles)

    if total <= 0:
        raise ReglaNegocioError(
            "El total del pedido debe ser mayor a cero."
        )

    pedido.total = total
    pedido.save(
        update_fields=[
            "total",
            "actualizado_en",
        ]
    )

    return total


@transaction.atomic
def _persistir_precios_pendientes(*, pedido_id, lineas_precio):
    pedido = obtener_pedido_pendiente(
        pedido_id
    )

    if pedido is None:
        raise ReglaNegocioError(
            "El pedido no existe o ya fue gestionado."
        )

    _aplicar_precios_pendientes(
        pedido,
        lineas_precio,
    )


def _bloquear_pedido(pedido_id):
    return (
        Pedido.objects
        .select_for_update()
        .filter(pk=pedido_id)
        .first()
    )


def _validar_detalles_para_confirmar(pedido):
    detalles = _obtener_detalles(pedido)

    if not detalles:
        raise ReglaNegocioError(
            "El pedido no contiene productos."
        )

    if any(detalle.precio_pendiente for detalle in detalles):
        raise ReglaNegocioError(
            "Todavía hay recargas pendientes de precio."
        )

    if any(detalle.cantidad <= 0 for detalle in detalles):
        raise ReglaNegocioError(
            "La cantidad debe ser mayor a cero."
        )

    if any(detalle.precio_unitario <= 0 for detalle in detalles):
        raise ReglaNegocioError(
            "Todas las líneas del pedido deben tener un precio final "
            "mayor a cero."
        )

    total = _calcular_total(detalles)

    if total <= 0:
        raise ReglaNegocioError(
            "El total del pedido debe ser mayor a cero."
        )

    return total


def _registrar_pago_de_confirmacion(
    *,
    pedido,
    monto,
    fecha_pago,
    usuario,
    metodo_pago,
    referencia,
):
    if monto <= 0:
        return None

    return registrar_anticipo(
        pedido_id=pedido.id,
        monto=monto,
        fecha=fecha_pago,
        usuario=usuario,
        metodo_pago=metodo_pago,
        referencia=referencia,
        clave_idempotencia=(
            f"pedido-confirmacion-pago:{pedido.id}"
        ),
    )


@transaction.atomic
def confirmar_pedido(
    *,
    pedido_id,
    estado_pago,
    usuario,
    lineas_precio=None,
    monto_recibido=None,
    fecha_pago=None,
    metodo_pago="",
    referencia="",
):
    """
    Confirmación comercial del pedido.

    No crea la venta financiera ni exige una compra previa. Persiste
    los precios finales, cambia el pedido a confirmado y, si hubo un
    pago real en ese momento, registra un anticipo vinculado al pedido.
    """

    if estado_pago not in Venta.EstadoPago.values:
        raise ReglaNegocioError(
            "Estado de pago inválido."
        )

    pedido = _bloquear_pedido(pedido_id)

    if pedido is None:
        raise ReglaNegocioError("Pedido no encontrado.")

    if pedido.venta_id:
        return pedido

    if pedido.estado != Pedido.Estado.PENDIENTE:
        if pedido.confirmado_por_id:
            return pedido

        raise ReglaNegocioError(
            "El pedido no se puede confirmar en su estado actual."
        )

    _aplicar_precios_pendientes(
        pedido,
        lineas_precio,
    )

    total = _validar_detalles_para_confirmar(pedido)

    monto = _validar_pago(
        estado_pago=estado_pago,
        monto_recibido=monto_recibido,
        total=total,
    )

    estado_anterior = pedido.estado
    pedido.estado = Pedido.Estado.CONFIRMADO
    pedido.confirmado_por = usuario
    pedido.total = total
    pedido.save(
        update_fields=[
            "estado",
            "confirmado_por",
            "total",
            "actualizado_en",
        ]
    )

    registrar_transicion(
        pedido=pedido,
        estado_anterior=estado_anterior,
        estado_nuevo=Pedido.Estado.CONFIRMADO,
        usuario=usuario,
        motivo="Confirmación comercial",
    )

    _registrar_pago_de_confirmacion(
        pedido=pedido,
        monto=monto,
        fecha_pago=fecha_pago,
        usuario=usuario,
        metodo_pago=metodo_pago,
        referencia=referencia,
    )

    reservar_stock_pedido(pedido, usuario)
    finalizar_abastecimiento_pedido(
        pedido_id=pedido.id,
        usuario=usuario,
    )

    pedido.refresh_from_db()
    return pedido


@transaction.atomic
def rechazar_pedido(
    *,
    pedido_id,
    usuario,
    motivo="",
):
    pedido = obtener_pedido_pendiente(
        pedido_id
    )

    if pedido is None:
        raise ReglaNegocioError(
            "El pedido no existe o ya fue gestionado."
        )

    estado_anterior = pedido.estado
    pedido.estado = Pedido.Estado.RECHAZADO
    pedido.confirmado_por = usuario
    pedido.motivo_rechazo = motivo

    pedido.save(
        update_fields=[
            "estado",
            "confirmado_por",
            "motivo_rechazo",
            "actualizado_en",
        ]
    )

    registrar_transicion(
        pedido=pedido,
        estado_anterior=estado_anterior,
        estado_nuevo=Pedido.Estado.RECHAZADO,
        usuario=usuario,
        motivo=motivo,
    )

    return pedido



