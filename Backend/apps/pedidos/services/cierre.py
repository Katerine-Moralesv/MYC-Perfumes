from decimal import Decimal

from django.db import transaction
from django.utils import timezone

from apps.catalogo.models import PresentacionProducto
from apps.core.exceptions import ReglaNegocioError
from apps.finanzas.services.inventario import reservar_stock_pedido
from apps.finanzas.services.ventas import registrar_venta_para_pedido
from apps.pedidos.models import Pedido
from apps.pedidos.services.historial import registrar_transicion


ESTADOS_CON_VENTA = {
    Pedido.Estado.CONFIRMADO,
    Pedido.Estado.POR_COMPRAR,
    Pedido.Estado.COMPRADO,
}

TRANSICIONES_ESTADO = {
    Pedido.Estado.CONFIRMADO: {Pedido.Estado.PREPARANDO},
    Pedido.Estado.POR_COMPRAR: {Pedido.Estado.COMPRADO},
    Pedido.Estado.COMPRADO: {Pedido.Estado.PREPARANDO},
    Pedido.Estado.PREPARANDO: {Pedido.Estado.LISTO},
    Pedido.Estado.LISTO: {Pedido.Estado.ENTREGADO},
}


def _presentacion_de_detalle(detalle):
    if detalle.presentacion_id:
        return detalle.presentacion

    producto = detalle.producto

    if producto is None:
        return None

    presentacion = (
        PresentacionProducto.objects
        .filter(
            producto=producto,
            porcentaje=detalle.porcentaje_recarga,
        )
        .first()
    )

    if presentacion is not None:
        return presentacion

    return PresentacionProducto.objects.create(
        producto=producto,
        porcentaje=detalle.porcentaje_recarga,
        activo=True,
    )


def pedido_listo_para_venta(pedido):
    detalles = list(pedido.detalles.all())

    if not detalles:
        return False

    for detalle in detalles:
        if detalle.precio_pendiente:
            return False

        if detalle.precio_unitario <= 0:
            return False

        if detalle.cantidad_recibida < detalle.cantidad:
            return False

        if not detalle.tiene_costo_real:
            return False

    return True


def _marcar_estado(
    *,
    pedido,
    nuevo_estado,
    usuario,
    motivo="",
):
    anterior = pedido.estado

    if anterior == nuevo_estado:
        return pedido

    pedido.estado = nuevo_estado
    pedido.save(update_fields=["estado", "actualizado_en"])

    registrar_transicion(
        pedido=pedido,
        estado_anterior=anterior,
        estado_nuevo=nuevo_estado,
        usuario=usuario,
        motivo=motivo,
    )

    return pedido


@transaction.atomic
def completar_venta_pedido(
    *,
    pedido_id,
    usuario,
    clave_idempotencia=None,
):
    pedido = (
        Pedido.objects
        .select_for_update()
        .filter(pk=pedido_id)
        .first()
    )

    if pedido is None:
        raise ReglaNegocioError("Pedido no encontrado.")

    if pedido.venta_id:
        return pedido.venta

    if pedido.estado not in ESTADOS_CON_VENTA:
        raise ReglaNegocioError(
            "La venta financiera solo se puede generar para un pedido "
            "confirmado o abastecido."
        )

    detalles = list(
        pedido.detalles
        .select_for_update(of=("self",))
        .select_related("producto", "presentacion__producto")
        .all()
    )

    if not detalles:
        raise ReglaNegocioError("El pedido no contiene productos.")

    if any(detalle.precio_pendiente for detalle in detalles):
        raise ReglaNegocioError(
            "Todavía hay líneas con precio pendiente."
        )

    if any(detalle.precio_unitario <= 0 for detalle in detalles):
        raise ReglaNegocioError(
            "Todas las líneas deben tener un precio mayor a cero."
        )

    if any(
        detalle.cantidad_recibida < detalle.cantidad
        for detalle in detalles
    ):
        raise ReglaNegocioError(
            "Las existencias y compras recibidas no cubren todas las "
            "cantidades del pedido."
        )

    if any(not detalle.tiene_costo_real for detalle in detalles):
        raise ReglaNegocioError(
            "Falta asignar el costo real de una o más líneas del pedido."
        )

    lineas = []

    for detalle in detalles:
        presentacion = _presentacion_de_detalle(detalle)

        if presentacion is None:
            raise ReglaNegocioError(
                "No se pudo determinar la presentación de una línea del "
                "pedido."
            )

        lineas.append({
            "presentacion_id": presentacion.id,
            "presentacion": presentacion,
            "cantidad": detalle.cantidad,
            "precio_venta": detalle.precio_unitario,
            "costo_unitario": detalle.costo_unitario_real,
        })

    venta = registrar_venta_para_pedido(
        pedido=pedido,
        lineas=lineas,
        usuario=usuario,
        fecha=pedido.creado_en.date(),
        clave_idempotencia=(
            clave_idempotencia
            or f"pedido-confirmacion:{pedido.id}"
        ),
    )

    pedido.venta = venta
    pedido.save(
        update_fields=[
            "venta",
            "actualizado_en",
        ]
    )
    _marcar_estado(
        pedido=pedido,
        nuevo_estado=Pedido.Estado.COMPRADO,
        usuario=usuario,
        motivo="Abastecimiento completo",
    )

    return venta


@transaction.atomic
def finalizar_abastecimiento_pedido(
    *,
    pedido_id,
    usuario,
):
    pedido = (
        Pedido.objects
        .select_for_update()
        .filter(pk=pedido_id)
        .first()
    )

    if pedido is None:
        raise ReglaNegocioError("Pedido no encontrado.")

    if pedido.venta_id:
        return pedido

    if pedido.estado in (
        Pedido.Estado.CANCELADO,
        Pedido.Estado.RECHAZADO,
        Pedido.Estado.ENTREGADO,
    ):
        return pedido

    if pedido_listo_para_venta(pedido):
        _marcar_estado(
            pedido=pedido,
            nuevo_estado=Pedido.Estado.COMPRADO,
            usuario=usuario,
            motivo="Cobertura completa de existencias y compras recibidas",
        )
        completar_venta_pedido(
            pedido_id=pedido.id,
            usuario=usuario,
        )
    elif pedido.estado in (
        Pedido.Estado.CONFIRMADO,
        Pedido.Estado.POR_COMPRAR,
    ):
        _marcar_estado(
            pedido=pedido,
            nuevo_estado=Pedido.Estado.POR_COMPRAR,
            usuario=usuario,
            motivo="Faltan unidades por recibir",
        )

    return pedido


@transaction.atomic
def reconciliar_pedidos_por_comprar(
    *,
    usuario,
    producto_ids=None,
    pedido_ids=None,
):
    """
    Reserva existencias libres para pedidos confirmados o por comprar.

    Se ejecuta después de una recepción para que el inventario que
    llegó como stock general también cubra pedidos pendientes. Los
    pedidos se procesan del más antiguo al más reciente para que dos
    pedidos no reserven la misma unidad.
    """

    pedidos = (
        Pedido.objects
        .select_for_update()
        .filter(
            venta__isnull=True,
            estado__in=[
                Pedido.Estado.CONFIRMADO,
                Pedido.Estado.POR_COMPRAR,
            ],
        )
        .order_by("creado_en", "id")
    )

    if pedido_ids:
        pedidos = pedidos.filter(pk__in=pedido_ids)

    if producto_ids:
        pedidos = pedidos.filter(
            pk__in=(
                Pedido.objects
                .filter(detalles__producto_id__in=producto_ids)
                .values("pk")
            )
        )

    reconciliados = []

    for pedido in pedidos:
        reservar_stock_pedido(pedido, usuario)
        finalizar_abastecimiento_pedido(
            pedido_id=pedido.id,
            usuario=usuario,
        )
        reconciliados.append(pedido.id)

    return reconciliados


@transaction.atomic
def actualizar_estado_pedido(
    *,
    pedido_id,
    nuevo_estado,
    usuario,
    motivo="",
):
    pedido = (
        Pedido.objects
        .select_for_update()
        .filter(pk=pedido_id)
        .first()
    )

    if pedido is None:
        raise ReglaNegocioError("Pedido no encontrado.")

    if pedido.estado == nuevo_estado:
        return pedido

    permitidos = TRANSICIONES_ESTADO.get(pedido.estado, set())

    if nuevo_estado not in permitidos:
        raise ReglaNegocioError(
            f"No se puede cambiar el pedido de '{pedido.estado}' "
            f"a '{nuevo_estado}'."
        )

    if (
        nuevo_estado == Pedido.Estado.ENTREGADO
        and pedido.venta_id is None
    ):
        raise ReglaNegocioError(
            "No se puede entregar un pedido sin venta financiera."
        )

    if nuevo_estado == Pedido.Estado.PREPARANDO:
        if not pedido_listo_para_venta(pedido):
            raise ReglaNegocioError(
                "El pedido todavía no está completamente abastecido."
            )

        if pedido.venta_id is None:
            raise ReglaNegocioError(
                "No se puede preparar un pedido sin venta financiera."
            )

    if nuevo_estado == Pedido.Estado.ENTREGADO:
        pedido.entregado_en = timezone.now()
        pedido.entregado_por = usuario
        pedido.save(
            update_fields=[
                "entregado_en",
                "entregado_por",
                "actualizado_en",
            ]
        )

    return _marcar_estado(
        pedido=pedido,
        nuevo_estado=nuevo_estado,
        usuario=usuario,
        motivo=motivo,
    )
