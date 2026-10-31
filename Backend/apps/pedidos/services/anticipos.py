from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum

from apps.core.exceptions import ConflictoError, ReglaNegocioError
from apps.finanzas.models import Abono
from apps.finanzas.services.pagos import convertir_monto, normalizar_fecha_pago
from apps.pedidos.models import Pedido


ESTADOS_CON_ANTICIPO = {
    Pedido.Estado.CONFIRMADO,
    Pedido.Estado.POR_COMPRAR,
    Pedido.Estado.COMPRADO,
    Pedido.Estado.PREPARANDO,
    Pedido.Estado.LISTO,
}


def _total_anticipos(pedido):
    return (
        pedido.abonos
        .filter(venta__isnull=True)
        .aggregate(total=Sum("monto"))["total"]
        or Decimal("0.00")
    )


def _validar_idempotencia(
    *,
    abono,
    pedido_id,
    monto,
    fecha,
    metodo_pago,
    referencia,
):
    if (
        abono.pedido_id != pedido_id
        or abono.monto != monto
        or abono.fecha != fecha
        or (abono.metodo_pago or "") != metodo_pago
        or (abono.referencia or "") != referencia
    ):
        raise ConflictoError(
            "La Idempotency-Key ya fue utilizada con datos distintos."
        )


@transaction.atomic
def registrar_anticipo(
    *,
    pedido_id,
    monto,
    fecha,
    usuario,
    metodo_pago="",
    referencia="",
    clave_idempotencia=None,
):
    """
    Registra un anticipo real del cliente antes de crear la venta.

    No exige una Venta y no crea una segunda contabilidad: usa el mismo
    modelo Abono, vinculado al Pedido y con venta=NULL hasta que la
    venta financiera se genere.
    """

    monto = convertir_monto(monto)
    fecha = normalizar_fecha_pago(fecha)
    metodo_pago = str(metodo_pago or "").strip()
    referencia = str(referencia or "").strip()
    clave = str(clave_idempotencia or "").strip() or None

    pedido = (
        Pedido.objects
        .select_for_update()
        .filter(pk=pedido_id)
        .first()
    )

    if pedido is None:
        raise ReglaNegocioError("Pedido no encontrado.")

    if pedido.venta_id:
        raise ReglaNegocioError(
            "El pedido ya tiene una venta financiera. Registra el "
            "pago como abono de la venta."
        )

    if pedido.estado not in ESTADOS_CON_ANTICIPO:
        raise ReglaNegocioError(
            "Solo se pueden registrar anticipos de un pedido confirmado "
            "que todavía no tiene venta financiera."
        )

    if pedido.total <= 0:
        raise ReglaNegocioError(
            "Define el total del pedido antes de registrar un anticipo."
        )

    if clave:
        existente = (
            Abono.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is not None:
            _validar_idempotencia(
                abono=existente,
                pedido_id=pedido.id,
                monto=monto,
                fecha=fecha,
                metodo_pago=metodo_pago,
                referencia=referencia,
            )
            return existente

    total_anticipos = _total_anticipos(pedido)

    if total_anticipos + monto > pedido.total:
        raise ReglaNegocioError(
            "El anticipo excede el saldo pendiente del pedido."
        )

    try:
        with transaction.atomic():
            return Abono.objects.create(
                pedido=pedido,
                venta=None,
                monto=monto,
                fecha=fecha,
                tipo=Abono.Tipo.ANTICIPO,
                metodo_pago=metodo_pago,
                referencia=referencia,
                clave_idempotencia=clave,
                registrado_por=usuario,
            )
    except IntegrityError:
        if not clave:
            raise

        existente = (
            Abono.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is None:
            raise

        _validar_idempotencia(
            abono=existente,
            pedido_id=pedido.id,
            monto=monto,
            fecha=fecha,
            metodo_pago=metodo_pago,
            referencia=referencia,
        )
        return existente
