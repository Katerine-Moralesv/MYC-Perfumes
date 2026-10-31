from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum
from django.utils import timezone

from apps.core.exceptions import ConflictoError, ReglaNegocioError
from apps.finanzas.models import Devolucion
from apps.finanzas.services.inventario import liberar_reservas_pedido
from apps.finanzas.services.pagos import convertir_monto, normalizar_fecha_pago
from apps.pedidos.models import Pedido
from apps.pedidos.services.historial import registrar_transicion


def _pagos_del_pedido(pedido):
    if pedido.venta_id:
        return (
            pedido.venta.abonos
            .aggregate(total=Sum("monto"))["total"]
            or Decimal("0.00")
        )

    return (
        pedido.abonos
        .aggregate(total=Sum("monto"))["total"]
        or Decimal("0.00")
    )


def _devoluciones_del_pedido(pedido):
    return (
        Devolucion.objects
        .filter(pedido=pedido)
        .aggregate(total=Sum("monto"))["total"]
        or Decimal("0.00")
    )


def _validar_idempotencia(
    *,
    devolucion,
    pedido_id,
    monto,
    fecha,
    metodo_pago,
    referencia,
    motivo,
):
    if (
        devolucion.pedido_id != pedido_id
        or devolucion.monto != monto
        or devolucion.fecha != fecha
        or (devolucion.metodo_pago or "") != metodo_pago
        or (devolucion.referencia or "") != referencia
        or (devolucion.motivo or "") != motivo
    ):
        raise ConflictoError(
            "La Idempotency-Key ya fue utilizada con datos distintos."
        )


@transaction.atomic
def registrar_devolucion(
    *,
    pedido_id,
    monto,
    fecha,
    usuario,
    metodo_pago="",
    referencia="",
    motivo="",
    clave_idempotencia=None,
):
    monto = convertir_monto(monto)
    fecha = normalizar_fecha_pago(fecha)
    metodo_pago = str(metodo_pago or "").strip()
    referencia = str(referencia or "").strip()
    motivo = str(motivo or "").strip()
    clave = str(clave_idempotencia or "").strip() or None

    pedido = (
        Pedido.objects
        .select_for_update()
        .filter(pk=pedido_id)
        .first()
    )

    if pedido is None:
        raise ReglaNegocioError("Pedido no encontrado.")

    if clave:
        existente = (
            Devolucion.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is not None:
            _validar_idempotencia(
                devolucion=existente,
                pedido_id=pedido.id,
                monto=monto,
                fecha=fecha,
                metodo_pago=metodo_pago,
                referencia=referencia,
                motivo=motivo,
            )
            return existente

    disponible = (
        _pagos_del_pedido(pedido)
        - _devoluciones_del_pedido(pedido)
    )

    if monto > disponible:
        raise ReglaNegocioError(
            "La devolución supera el dinero pendiente de devolver "
            f"del pedido (${disponible})."
        )

    abono = None

    if pedido.venta_id is None:
        anticipos = list(
            pedido.abonos
            .filter(venta__isnull=True)
            .order_by("id")
        )

        if len(anticipos) == 1:
            abono = anticipos[0]

    try:
        with transaction.atomic():
            return Devolucion.objects.create(
                pedido=pedido,
                venta=pedido.venta,
                abono=abono,
                monto=monto,
                fecha=fecha,
                metodo_pago=metodo_pago,
                referencia=referencia,
                motivo=motivo,
                clave_idempotencia=clave,
                registrado_por=usuario,
            )
    except IntegrityError:
        if not clave:
            raise

        existente = (
            Devolucion.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is None:
            raise

        _validar_idempotencia(
            devolucion=existente,
            pedido_id=pedido.id,
            monto=monto,
            fecha=fecha,
            metodo_pago=metodo_pago,
            referencia=referencia,
            motivo=motivo,
        )
        return existente


@transaction.atomic
def cancelar_pedido(
    *,
    pedido_id,
    usuario,
    motivo="",
    monto_devolucion=None,
    fecha_devolucion=None,
    metodo_pago="",
    referencia="",
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

    if pedido.estado == Pedido.Estado.CANCELADO:
        return pedido

    if pedido.estado == Pedido.Estado.RECHAZADO:
        raise ReglaNegocioError(
            "Un pedido rechazado no se puede cancelar."
        )

    if pedido.estado == Pedido.Estado.ENTREGADO:
        raise ReglaNegocioError(
            "No se puede cancelar un pedido ya entregado."
        )

    disponible = (
        _pagos_del_pedido(pedido)
        - _devoluciones_del_pedido(pedido)
    )

    if monto_devolucion in (None, ""):
        monto = disponible
    else:
        monto = convertir_monto(monto_devolucion)

        if monto > disponible:
            raise ReglaNegocioError(
                "La devolución supera el dinero pendiente de devolver "
                f"del pedido (${disponible})."
            )

    if monto > 0:
        registrar_devolucion(
            pedido_id=pedido.id,
            monto=monto,
            fecha=fecha_devolucion or timezone.localdate(),
            usuario=usuario,
            metodo_pago=metodo_pago,
            referencia=referencia,
            motivo=motivo,
            clave_idempotencia=(
                clave_idempotencia
                or f"pedido-cancelacion:{pedido.id}"
            ),
        )

    estado_anterior = pedido.estado
    liberar_reservas_pedido(pedido, usuario)

    pedido.estado = Pedido.Estado.CANCELADO
    pedido.cancelado_por = usuario
    pedido.motivo_cancelacion = str(motivo or "").strip()
    pedido.cancelado_en = timezone.now()
    pedido.save(
        update_fields=[
            "estado",
            "cancelado_por",
            "motivo_cancelacion",
            "cancelado_en",
            "actualizado_en",
        ]
    )

    registrar_transicion(
        pedido=pedido,
        estado_anterior=estado_anterior,
        estado_nuevo=Pedido.Estado.CANCELADO,
        usuario=usuario,
        motivo=pedido.motivo_cancelacion,
    )

    return pedido
