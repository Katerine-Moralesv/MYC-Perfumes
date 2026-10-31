from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction
from django.utils import timezone

from apps.core.exceptions import ConflictoError, ReglaNegocioError
from apps.finanzas.models import Abono, Venta
from apps.finanzas.repositories import obtener_venta_para_actualizar


def normalizar_fecha_pago(fecha):
    if fecha in (None, ""):
        fecha = timezone.localdate()

    if isinstance(fecha, datetime):
        if timezone.is_aware(fecha):
            fecha = timezone.localtime(fecha).date()
        else:
            fecha = fecha.date()
    elif isinstance(fecha, str):
        try:
            fecha = date.fromisoformat(fecha)
        except ValueError:
            raise ReglaNegocioError(
                "La fecha de pago no es válida."
            )
    elif isinstance(fecha, date):
        pass
    else:
        raise ReglaNegocioError(
            "La fecha de pago no es válida."
        )

    if fecha > timezone.localdate():
        raise ReglaNegocioError(
            "La fecha de pago no puede ser futura."
        )

    return fecha


def convertir_monto(monto):
    try:
        valor = Decimal(str(monto))
    except (InvalidOperation, TypeError, ValueError):
        raise ReglaNegocioError(
            "El monto del pago no es válido."
        )

    if not valor.is_finite() or valor <= 0:
        raise ReglaNegocioError(
            "El monto del pago debe ser mayor a cero."
        )

    return valor


def _validar_pago_idempotente(
    *,
    abono,
    venta_id,
    monto,
    fecha,
):
    if (
        abono.venta_id != venta_id
        or abono.monto != monto
        or abono.fecha != fecha
    ):
        raise ConflictoError(
            "La Idempotency-Key ya fue utilizada con datos distintos."
        )


@transaction.atomic
def registrar_abono(
    *,
    venta_id,
    monto,
    fecha,
    usuario,
    clave_idempotencia=None,
):
    fecha = normalizar_fecha_pago(fecha)
    monto = convertir_monto(monto)

    venta = obtener_venta_para_actualizar(venta_id)
    if venta is None:
        raise ReglaNegocioError("Venta no encontrada.")

    if clave_idempotencia:
        existente = Abono.objects.filter(
            clave_idempotencia=clave_idempotencia
        ).first()

        if existente is not None:
            _validar_pago_idempotente(
                abono=existente,
                venta_id=venta.id,
                monto=monto,
                fecha=fecha,
            )
            return venta

    if monto > venta.saldo:
        raise ReglaNegocioError(
            f"El abono excede el saldo pendiente (${venta.saldo})."
        )

    try:
        with transaction.atomic():
            Abono.objects.create(
                venta=venta,
                monto=monto,
                fecha=fecha,
                tipo=Abono.Tipo.POSTERIOR,
                clave_idempotencia=clave_idempotencia,
                registrado_por=usuario,
            )
    except IntegrityError:
        existente = Abono.objects.filter(
            clave_idempotencia=clave_idempotencia
        ).first()

        if existente is None:
            raise

        _validar_pago_idempotente(
            abono=existente,
            venta_id=venta.id,
            monto=monto,
            fecha=fecha,
        )
        return venta

    venta.saldo -= monto
    venta.estado_pago = (
        Venta.EstadoPago.PAGADO
        if venta.saldo == 0
        else Venta.EstadoPago.ABONADO
    )
    venta.save(update_fields=["saldo", "estado_pago"])
    return venta
