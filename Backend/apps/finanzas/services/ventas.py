import hashlib
import json
from datetime import date, datetime
from decimal import Decimal, InvalidOperation

from django.db import IntegrityError, transaction

from apps.core.exceptions import ConflictoError, ReglaNegocioError
from apps.core.utils import normalizar_telefono
from apps.finanzas.models import Abono, Cliente, Venta, DetalleVenta
from apps.finanzas.repositories import (
    obtener_cliente_o_none,
    obtener_o_crear_cliente_por_telefono,
    obtener_presentacion_activa,
)
from apps.finanzas.services.inventario import (
    asignar_stock_para_venta,
)
from apps.finanzas.services.pagos import (
    convertir_monto,
    normalizar_fecha_pago,
)


def _normalizar_fecha_hash(valor):
    if valor in (None, ""):
        return None

    if isinstance(valor, datetime):
        return valor.date().isoformat()

    if isinstance(valor, date):
        return valor.isoformat()

    return str(valor)


def _normalizar_decimal_hash(valor):
    if valor in (None, ""):
        return None

    try:
        return format(
            Decimal(str(valor)).quantize(Decimal("0.01")),
            "f",
        )
    except (InvalidOperation, TypeError, ValueError):
        return str(valor)


def _hash_solicitud_venta(
    *,
    cliente_id,
    cliente_nombre,
    cliente_telefono,
    fecha,
    estado_pago,
    monto_inicial,
    fecha_pago,
    lineas,
    usuario,
):
    lineas_canonicas = sorted(
        [
            {
                "presentacion_id": int(linea["presentacion_id"]),
                "cantidad": int(linea["cantidad"]),
                "precio_venta": _normalizar_decimal_hash(
                    linea["precio_venta"]
                ),
            }
            for linea in lineas
        ],
        key=lambda linea: (
            linea["presentacion_id"],
            linea["cantidad"],
            linea["precio_venta"],
        ),
    )

    contenido = {
        "usuario_id": getattr(usuario, "pk", None),
        "cliente_id": cliente_id or None,
        "cliente_nombre": (
            ""
            if cliente_id
            else (cliente_nombre or "").strip()
        ),
        "cliente_telefono": (
            ""
            if cliente_id
            else normalizar_telefono(cliente_telefono)
        ),
        "fecha": _normalizar_fecha_hash(fecha),
        "estado_pago": estado_pago,
        "monto_inicial": _normalizar_decimal_hash(
            monto_inicial
        ),
        "fecha_pago": _normalizar_fecha_hash(fecha_pago),
        "lineas": lineas_canonicas,
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


def _validar_venta_idempotente(
    *,
    venta,
    hash_solicitud,
    usuario,
):
    if (
        venta.hash_solicitud != hash_solicitud
        or venta.registrado_por_id != getattr(usuario, "pk", None)
    ):
        raise ConflictoError(
            "La Idempotency-Key ya fue utilizada con datos distintos."
        )


def _resolver_monto_inicial(
    *,
    estado_pago,
    total,
    monto_inicial,
):
    if estado_pago == Venta.EstadoPago.PENDIENTE:
        if monto_inicial not in (None, ""):
            raise ReglaNegocioError(
                "Una venta pendiente no puede tener pago inicial."
            )

        return Decimal("0")

    if estado_pago == Venta.EstadoPago.PAGADO:
        if monto_inicial in (None, ""):
            return total

        monto = convertir_monto(monto_inicial)

        if monto != total:
            raise ReglaNegocioError(
                "El pago inicial de una venta pagada debe coincidir "
                "con el total."
            )

        return total

    if monto_inicial in (None, ""):
        raise ReglaNegocioError(
            "Indica el monto inicial para registrar la venta abonada."
        )

    monto = convertir_monto(monto_inicial)

    if monto >= total:
        raise ReglaNegocioError(
            "El abono inicial debe ser menor que el total. "
            "Para un pago completo usa estado_pago='pagado'."
        )

    return monto


@transaction.atomic
def _crear_venta(
    *,
    fecha,
    estado_pago,
    lineas,
    usuario,
    cliente_id=None,
    cliente_nombre="",
    cliente_telefono="",
    monto_inicial=None,
    fecha_pago=None,
    clave_idempotencia=None,
    hash_solicitud="",
):
    """
    lineas:
    [
        {
            "presentacion_id": 1,
            "cantidad": 2,
            "precio_venta": 45000
        }
    ]
    """

    if not lineas:
        raise ReglaNegocioError(
            "La venta debe tener al menos un producto."
        )

    if cliente_id:
        cliente = obtener_cliente_o_none(cliente_id)

        if cliente is None:
            raise ReglaNegocioError(
                "Cliente no encontrado."
            )
    else:
        nombre = (cliente_nombre or "").strip()

        if not nombre:
            raise ReglaNegocioError(
                "El nombre del cliente es obligatorio."
            )

        telefono = (cliente_telefono or "").strip()

        if telefono:
            telefono_normalizado = normalizar_telefono(
                telefono
            )
            digitos = telefono_normalizado.lstrip("+")

            if (
                not telefono_normalizado
                or len(digitos) < 7
                or len(digitos) > 15
            ):
                raise ReglaNegocioError(
                    "El teléfono del cliente debe contener "
                    "entre 7 y 15 dígitos válidos."
                )

            cliente = obtener_o_crear_cliente_por_telefono(
                telefono_normalizado,
                nombre,
            )
        else:
            cliente = Cliente.objects.create(
                nombre=nombre,
            )

    if estado_pago not in Venta.EstadoPago.values:
        raise ReglaNegocioError(
            "Estado de pago inválido."
        )

    ids = [
        linea["presentacion_id"]
        for linea in lineas
    ]

    if len(ids) != len(set(ids)):
        raise ReglaNegocioError(
            "No se puede repetir una presentación dentro de una venta."
        )

    total = Decimal("0")
    lineas_validadas = []

    for linea in lineas:
        presentacion = obtener_presentacion_activa(
            linea["presentacion_id"]
        )

        if presentacion is None:
            raise ReglaNegocioError(
                "La presentación indicada no existe o está inactiva."
            )

        precio = Decimal(
            str(linea["precio_venta"])
        )

        cantidad = int(linea["cantidad"])

        if cantidad <= 0:
            raise ReglaNegocioError(
                "La cantidad debe ser mayor a cero."
            )

        if precio <= 0:
            raise ReglaNegocioError(
                "El precio de venta debe ser mayor a cero."
            )

        lineas_validadas.append({
            "presentacion": presentacion,
            "cantidad": cantidad,
            "precio_venta": precio,
        })
        total += precio * cantidad

    lineas_validadas = asignar_stock_para_venta(
        lineas_validadas
    )
    detalles = [
        DetalleVenta(
            presentacion=linea["presentacion"],
            cantidad=linea["cantidad"],
            cantidad_pendiente=linea["cantidad_pendiente"],
            precio_venta=linea["precio_venta"],
            costo_unitario=linea["costo_unitario"],
        )
        for linea in lineas_validadas
    ]

    monto_inicial = _resolver_monto_inicial(
        estado_pago=estado_pago,
        total=total,
        monto_inicial=monto_inicial,
    )
    fecha_pago = (
        normalizar_fecha_pago(fecha_pago)
        if monto_inicial > 0
        else None
    )
    saldo = total - monto_inicial

    venta = Venta.objects.create(
        cliente=cliente,
        fecha=fecha,
        estado_pago=estado_pago,
        registrado_por=usuario,
        total=total,
        saldo=saldo,
        clave_idempotencia=clave_idempotencia,
        hash_solicitud=hash_solicitud,
    )

    for detalle in detalles:
        detalle.venta = venta

    DetalleVenta.objects.bulk_create(detalles)

    if monto_inicial > 0:
        Abono.objects.create(
            venta=venta,
            monto=monto_inicial,
            fecha=fecha_pago,
            tipo=Abono.Tipo.INICIAL,
            registrado_por=usuario,
        )

    return venta


@transaction.atomic
def reconciliar_ventas_pendientes(*, usuario, producto_ids=None):
    """
    Cubre FIFO las líneas de ventas manuales pendientes de recibir.

    Se ejecuta después de recibir mercancía. Solo consume existencias
    libres y actualiza el faltante y el costo real de lo cubierto.
    """

    qs = (
        DetalleVenta.objects
        .select_for_update(of=("self",))
        .select_related("venta", "presentacion__producto")
        .filter(cantidad_pendiente__gt=0)
        .order_by("venta__fecha", "venta_id", "id")
    )

    if producto_ids:
        qs = qs.filter(
            presentacion__producto_id__in=producto_ids,
        )

    procesadas = 0

    for detalle in qs:
        resultado = asignar_stock_para_venta([
            {
                "presentacion": detalle.presentacion,
                "cantidad": detalle.cantidad_pendiente,
                "precio_venta": detalle.precio_venta,
            }
        ])[0]

        cubierta = resultado["cantidad_cubierta"]

        if cubierta <= 0:
            continue

        cantidad_cubierta_anterior = detalle.cantidad_cubierta
        costo_anterior = detalle.costo_unitario
        costo_nuevo = resultado["costo_unitario"]

        if cantidad_cubierta_anterior > 0:
            valor_anterior = (
                costo_anterior * cantidad_cubierta_anterior
            )
            valor_nuevo = costo_nuevo * cubierta
            total_cubierto = (
                cantidad_cubierta_anterior + cubierta
            )
            detalle.costo_unitario = (
                (valor_anterior + valor_nuevo) / total_cubierto
            ).quantize(Decimal("0.01"))
        else:
            detalle.costo_unitario = costo_nuevo

        detalle.cantidad_pendiente = resultado[
            "cantidad_pendiente"
        ]
        detalle.save(
            update_fields=[
                "cantidad_pendiente",
                "costo_unitario",
            ]
        )
        procesadas += 1

    return procesadas


def registrar_venta(
    *,
    fecha,
    estado_pago,
    lineas,
    usuario,
    cliente_id=None,
    cliente_nombre="",
    cliente_telefono="",
    monto_inicial=None,
    fecha_pago=None,
    clave_idempotencia=None,
):
    clave = str(clave_idempotencia or "").strip() or None

    if clave and len(clave) > 64:
        raise ReglaNegocioError(
            "La Idempotency-Key admite máximo 64 caracteres."
        )

    hash_solicitud = _hash_solicitud_venta(
        cliente_id=cliente_id,
        cliente_nombre=cliente_nombre,
        cliente_telefono=cliente_telefono,
        fecha=fecha,
        estado_pago=estado_pago,
        monto_inicial=monto_inicial,
        fecha_pago=fecha_pago,
        lineas=lineas,
        usuario=usuario,
    )

    if clave:
        existente = (
            Venta.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is not None:
            _validar_venta_idempotente(
                venta=existente,
                hash_solicitud=hash_solicitud,
                usuario=usuario,
            )
            return existente

    try:
        with transaction.atomic():
            return _crear_venta(
                fecha=fecha,
                estado_pago=estado_pago,
                lineas=lineas,
                usuario=usuario,
                cliente_id=cliente_id,
                cliente_nombre=cliente_nombre,
                cliente_telefono=cliente_telefono,
                monto_inicial=monto_inicial,
                fecha_pago=fecha_pago,
                clave_idempotencia=clave,
                hash_solicitud=hash_solicitud,
            )
    except IntegrityError:
        if not clave:
            raise

        existente = (
            Venta.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is None:
            raise

        _validar_venta_idempotente(
            venta=existente,
            hash_solicitud=hash_solicitud,
            usuario=usuario,
        )
        return existente


@transaction.atomic
def registrar_venta_para_pedido(
    *,
    pedido,
    lineas,
    usuario,
    fecha=None,
    clave_idempotencia=None,
):
    """
    Genera la venta financiera de un pedido usando costos reales
    asignados explícitamente y concilia los anticipos existentes.

    No crea abonos nuevos por dinero ya recibido. Los anticipos del
    pedido se vinculan a la venta para que reportes y saldos sigan
    usando una sola fuente de pagos.
    """

    if not lineas:
        raise ReglaNegocioError(
            "La venta debe tener al menos un producto."
        )

    clave = str(clave_idempotencia or "").strip() or None

    if clave and len(clave) > 64:
        raise ReglaNegocioError(
            "La Idempotency-Key admite máximo 64 caracteres."
        )

    existente = (
        Venta.objects
        .filter(clave_idempotencia=clave)
        .first()
        if clave
        else None
    )

    if existente is not None:
        pedido_origen = getattr(existente, "pedido_origen", None)

        if (
            pedido_origen is None
            or pedido_origen.id != pedido.id
        ):
            raise ConflictoError(
                "La Idempotency-Key ya fue utilizada con datos distintos."
            )
        return existente

    venta_existente = (
        Venta.objects
        .filter(pedido_origen=pedido)
        .first()
    )

    if venta_existente is not None:
        return venta_existente

    fecha = fecha or pedido.creado_en.date()
    total = Decimal("0.00")
    detalles = []

    for linea in lineas:
        presentacion = linea.get("presentacion")

        if presentacion is None:
            presentacion = obtener_presentacion_activa(
                linea["presentacion_id"]
            )

        if presentacion is None:
            raise ReglaNegocioError(
                "La presentación indicada no existe o está inactiva."
            )

        cantidad = int(linea["cantidad"])
        precio = Decimal(str(linea["precio_venta"]))
        costo = Decimal(str(linea["costo_unitario"]))

        if cantidad <= 0:
            raise ReglaNegocioError(
                "La cantidad debe ser mayor a cero."
            )

        if precio <= 0:
            raise ReglaNegocioError(
                "El precio de venta debe ser mayor a cero."
            )

        if costo < 0:
            raise ReglaNegocioError(
                "El costo real no puede ser negativo."
            )

        detalles.append(
            DetalleVenta(
                presentacion=presentacion,
                cantidad=cantidad,
                precio_venta=precio,
                costo_unitario=costo,
            )
        )
        total += precio * cantidad

    anticipos = list(
        Abono.objects
        .select_for_update()
        .filter(pedido=pedido, venta__isnull=True)
    )
    pagado = sum(
        (abono.monto for abono in anticipos),
        Decimal("0.00"),
    )

    if pagado > total:
        raise ReglaNegocioError(
            "Los anticipos superan el total de la venta."
        )

    saldo = total - pagado

    if pagado == 0:
        estado_pago = Venta.EstadoPago.PENDIENTE
    elif saldo == 0:
        estado_pago = Venta.EstadoPago.PAGADO
    else:
        estado_pago = Venta.EstadoPago.ABONADO

    contenido_hash = {
        "pedido_id": pedido.id,
        "total": _normalizar_decimal_hash(total),
        "pagado": _normalizar_decimal_hash(pagado),
        "lineas": [
            {
                "presentacion_id": detalle.presentacion_id,
                "cantidad": detalle.cantidad,
                "precio_venta": _normalizar_decimal_hash(
                    detalle.precio_venta
                ),
                "costo_unitario": _normalizar_decimal_hash(
                    detalle.costo_unitario
                ),
            }
            for detalle in detalles
        ],
    }

    hash_solicitud = hashlib.sha256(
        json.dumps(
            contenido_hash,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()

    venta = Venta.objects.create(
        cliente=pedido.cliente,
        fecha=fecha,
        estado_pago=estado_pago,
        registrado_por=usuario,
        total=total,
        saldo=saldo,
        clave_idempotencia=clave,
        hash_solicitud=hash_solicitud,
    )

    for detalle in detalles:
        detalle.venta = venta

    DetalleVenta.objects.bulk_create(detalles)

    if anticipos:
        Abono.objects.filter(
            pk__in=[abono.pk for abono in anticipos]
        ).update(venta=venta)

    return venta
