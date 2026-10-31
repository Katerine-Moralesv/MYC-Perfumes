import hashlib
import json
from decimal import Decimal

from django.db import IntegrityError, transaction
from django.db.models import Sum

from apps.core.exceptions import ConflictoError, ReglaNegocioError
from apps.finanzas.models import (
    AsignacionCompraPedido,
    Compra,
    DetalleCompra,
    DetalleRecepcionCompra,
    RecepcionCompra,
)
from apps.finanzas.repositories import (
    obtener_presentacion_activa,
    obtener_proveedor_activo_o_none,
)
from apps.finanzas.services.inventario import (
    aplicar_cobertura_linea,
    producto_de_detalle,
)
from apps.pedidos.models import DetallePedido, Pedido


def _decimal(valor, mensaje):
    try:
        resultado = Decimal(str(valor))
    except (TypeError, ValueError):
        raise ReglaNegocioError(mensaje)

    if not resultado.is_finite():
        raise ReglaNegocioError(mensaje)

    return resultado


def _normalizar_decimal(valor):
    return format(
        Decimal(str(valor)).quantize(Decimal("0.01")),
        "f",
    )


def _hash_compra(*, proveedor_id, fecha, lineas):
    contenido = {
        "proveedor_id": int(proveedor_id),
        "fecha": str(fecha),
        "lineas": sorted(
            [
                {
                    "presentacion_id": int(linea["presentacion_id"]),
                    "cantidad": int(linea["cantidad"]),
                    "costo_unitario": _normalizar_decimal(
                        linea["costo_unitario"]
                    ),
                    "cantidad_recibida": int(
                        linea.get("cantidad_recibida") or 0
                    ),
                    "asignaciones": sorted(
                        [
                            {
                                "detalle_pedido_id": int(
                                    asignacion["detalle_pedido_id"]
                                ),
                                "cantidad": int(
                                    asignacion["cantidad"]
                                ),
                            }
                            for asignacion in (
                                linea.get("asignaciones") or []
                            )
                        ],
                        key=lambda asignacion: asignacion[
                            "detalle_pedido_id"
                        ],
                    ),
                }
                for linea in lineas
            ],
            key=lambda linea: linea["presentacion_id"],
        ),
    }

    return hashlib.sha256(
        json.dumps(
            contenido,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _hash_recepcion(*, compra_id, fecha, lineas):
    contenido = {
        "compra_id": int(compra_id),
        "fecha": str(fecha),
        "lineas": sorted(
            [
                {
                    "detalle_compra_id": int(
                        linea["detalle_compra_id"]
                    ),
                    "cantidad": int(linea["cantidad"]),
                    "asignaciones": sorted(
                        [
                            {
                                "detalle_pedido_id": int(
                                    asignacion["detalle_pedido_id"]
                                ),
                                "cantidad": int(
                                    asignacion["cantidad"]
                                ),
                            }
                            for asignacion in (
                                linea.get("asignaciones") or []
                            )
                        ],
                        key=lambda asignacion: asignacion[
                            "detalle_pedido_id"
                        ],
                    ),
                }
                for linea in lineas
            ],
            key=lambda linea: linea["detalle_compra_id"],
        ),
    }

    return hashlib.sha256(
        json.dumps(
            contenido,
            ensure_ascii=False,
            sort_keys=True,
            separators=(",", ":"),
        ).encode("utf-8")
    ).hexdigest()


def _validar_idempotencia_compra(compra, hash_solicitud):
    if compra.hash_solicitud != hash_solicitud:
        raise ConflictoError(
            "La Idempotency-Key ya fue utilizada con datos distintos."
        )


def _validar_idempotencia_recepcion(recepcion, hash_solicitud):
    if recepcion.hash_solicitud != hash_solicitud:
        raise ConflictoError(
            "La Idempotency-Key ya fue utilizada con datos distintos."
        )


def _bloquear_pedidos_de_asignaciones(lineas):
    ids = {
        int(asignacion["detalle_pedido_id"])
        for linea in lineas
        for asignacion in (linea.get("asignaciones") or [])
    }

    if not ids:
        return {}

    pedidos_ids = list(
        DetallePedido.objects
        .filter(pk__in=ids)
        .values_list("pedido_id", flat=True)
        .distinct()
    )

    pedidos = list(
        Pedido.objects
        .select_for_update()
        .filter(pk__in=sorted(pedidos_ids))
        .order_by("id")
    )

    return {pedido.id: pedido for pedido in pedidos}


@transaction.atomic
def registrar_compra(
    *,
    proveedor_id,
    fecha,
    lineas,
    usuario,
    clave_idempotencia=None,
):
    """
    Registra la compra al proveedor. Por defecto las unidades quedan
    pendientes de recepción. Si se envía cantidad_recibida mayor a cero
    se registra una recepción inmediata compatibles con el contrato
    anterior.
    """

    if not lineas:
        raise ReglaNegocioError(
            "La compra debe tener al menos un producto."
        )

    proveedor = obtener_proveedor_activo_o_none(proveedor_id)

    if proveedor is None:
        raise ReglaNegocioError(
            "Proveedor no encontrado o inactivo."
        )

    ids = [linea["presentacion_id"] for linea in lineas]

    if len(ids) != len(set(ids)):
        raise ReglaNegocioError(
            "No se puede repetir una presentación dentro de una compra."
        )

    clave = str(clave_idempotencia or "").strip() or None
    hash_solicitud = _hash_compra(
        proveedor_id=proveedor_id,
        fecha=fecha,
        lineas=lineas,
    )

    if clave:
        existente = (
            Compra.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is not None:
            _validar_idempotencia_compra(
                existente,
                hash_solicitud,
            )
            return existente

    try:
        with transaction.atomic():
            compra = Compra.objects.create(
                proveedor=proveedor,
                fecha=fecha,
                registrado_por=usuario,
                total=Decimal("0.00"),
                clave_idempotencia=clave,
                hash_solicitud=hash_solicitud,
            )
    except IntegrityError:
        if not clave:
            raise

        existente = (
            Compra.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is None:
            raise

        _validar_idempotencia_compra(
            existente,
            hash_solicitud,
        )
        return existente

    total = Decimal("0.00")
    lineas_recepcion = []

    for linea in lineas:
        presentacion = obtener_presentacion_activa(
            linea["presentacion_id"]
        )

        if presentacion is None:
            raise ReglaNegocioError(
                "La presentación indicada no existe o está inactiva."
            )

        costo = _decimal(
            linea["costo_unitario"],
            "El costo unitario no es válido.",
        )
        cantidad = int(linea["cantidad"])

        if cantidad <= 0:
            raise ReglaNegocioError(
                "La cantidad debe ser mayor a cero."
            )

        if costo <= 0:
            raise ReglaNegocioError(
                "El costo unitario debe ser mayor a cero."
            )

        detalle_compra = DetalleCompra.objects.create(
            compra=compra,
            presentacion=presentacion,
            cantidad=cantidad,
            costo_unitario=costo,
            cantidad_recibida=0,
        )

        total += costo * cantidad

        asignaciones_linea = linea.get("asignaciones") or []
        recibida_cruda = linea.get("cantidad_recibida")

        if recibida_cruda is None and asignaciones_linea:
            # Compatibilidad: asignar unidades implica que fueron
            # recibidas físicamente en la misma operación.
            cantidad_recibida = cantidad
        else:
            cantidad_recibida = int(recibida_cruda or 0)

        if cantidad_recibida < 0 or cantidad_recibida > cantidad:
            raise ReglaNegocioError(
                "La cantidad recibida debe estar entre cero y la "
                "cantidad comprada."
            )

        if cantidad_recibida > 0:
            lineas_recepcion.append({
                "detalle_compra_id": detalle_compra.id,
                "cantidad": cantidad_recibida,
                "asignaciones": asignaciones_linea,
            })
        elif asignaciones_linea:
            raise ReglaNegocioError(
                "Solo se puede asignar un pedido después de recibir "
                "físicamente las unidades."
            )

    compra.total = total
    compra.save(update_fields=["total"])

    if lineas_recepcion:
        clave_recepcion = None

        if clave:
            candidata = f"{clave}:recepcion"

            if len(candidata) <= 64:
                clave_recepcion = candidata
            else:
                clave_recepcion = hashlib.sha256(
                    candidata.encode("utf-8")
                ).hexdigest()

        registrar_recepcion(
            compra_id=compra.id,
            fecha=fecha,
            lineas=lineas_recepcion,
            usuario=usuario,
            clave_idempotencia=clave_recepcion,
        )
        compra.refresh_from_db()

    return compra


def _validar_asignacion(
    *,
    detalle_pedido,
    detalle_compra,
    cantidad,
):
    if detalle_pedido.pedido_id in (
        Pedido.objects.filter(
            pk=detalle_pedido.pedido_id,
            estado__in=[
                Pedido.Estado.CANCELADO,
                Pedido.Estado.RECHAZADO,
                Pedido.Estado.ENTREGADO,
            ],
        ).values_list("id", flat=True)
    ):
        raise ReglaNegocioError(
            "No se puede asignar inventario a un pedido cancelado, "
            "rechazado o entregado."
        )

    if detalle_pedido.pedido.venta_id:
        raise ReglaNegocioError(
            "El pedido ya tiene una venta financiera y no requiere más "
            "inventario."
        )

    producto_linea = producto_de_detalle(detalle_pedido)

    if (
        producto_linea is None
        or producto_linea.id != detalle_compra.presentacion.producto_id
    ):
        raise ReglaNegocioError(
            "El producto de la compra no corresponde a la línea del pedido."
        )

    if (
        detalle_pedido.porcentaje_recarga
        != detalle_compra.presentacion.porcentaje
    ):
        raise ReglaNegocioError(
            "La presentación de la compra no coincide con el porcentaje "
            "solicitado en la línea del pedido."
        )

    if (
        detalle_pedido.presentacion_id
        and detalle_pedido.presentacion_id
        != detalle_compra.presentacion_id
    ):
        raise ReglaNegocioError(
            "La presentación de la compra no corresponde a la "
            "presentación solicitada en la línea del pedido."
        )

    if cantidad <= 0:
        raise ReglaNegocioError(
            "La cantidad asignada debe ser mayor a cero."
        )

    if cantidad > detalle_pedido.cantidad_pendiente:
        raise ReglaNegocioError(
            "La cantidad asignada supera lo pendiente de la línea del "
            "pedido."
        )


def _asignar_detalle_compra(
    *,
    detalle_compra,
    detalle_pedido,
    cantidad,
    usuario,
):
    _validar_asignacion(
        detalle_pedido=detalle_pedido,
        detalle_compra=detalle_compra,
        cantidad=cantidad,
    )

    asignacion = (
        AsignacionCompraPedido.objects
        .select_for_update()
        .filter(
            detalle_compra=detalle_compra,
            detalle_pedido=detalle_pedido,
            liberada_en__isnull=True,
        )
        .first()
    )

    if asignacion is None:
        asignacion = AsignacionCompraPedido.objects.create(
            detalle_compra=detalle_compra,
            detalle_pedido=detalle_pedido,
            cantidad=cantidad,
            costo_unitario=detalle_compra.costo_unitario,
            registrado_por=usuario,
        )
    else:
        asignacion.cantidad += cantidad
        asignacion.costo_unitario = detalle_compra.costo_unitario
        asignacion.save(
            update_fields=[
                "cantidad",
                "costo_unitario",
                "actualizado_en",
            ]
        )

    aplicar_cobertura_linea(
        detalle_pedido=detalle_pedido,
        cantidad=cantidad,
        costo_unitario=detalle_compra.costo_unitario,
    )

    return asignacion


@transaction.atomic
def registrar_recepcion(
    *,
    compra_id,
    fecha,
    lineas,
    usuario,
    clave_idempotencia=None,
):
    if not lineas:
        raise ReglaNegocioError(
            "La recepción debe incluir al menos una línea."
        )

    clave = str(clave_idempotencia or "").strip() or None
    hash_solicitud = _hash_recepcion(
        compra_id=compra_id,
        fecha=fecha,
        lineas=lineas,
    )

    if clave:
        existente = (
            RecepcionCompra.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is not None:
            _validar_idempotencia_recepcion(
                existente,
                hash_solicitud,
            )
            return existente

    pedidos_bloqueados = _bloquear_pedidos_de_asignaciones(lineas)

    compra = (
        Compra.objects
        .select_for_update()
        .select_related("proveedor")
        .filter(pk=compra_id)
        .first()
    )

    if compra is None:
        raise ReglaNegocioError("Compra no encontrada.")

    try:
        with transaction.atomic():
            recepcion = RecepcionCompra.objects.create(
                compra=compra,
                fecha=fecha,
                registrado_por=usuario,
                clave_idempotencia=clave,
                hash_solicitud=hash_solicitud,
            )
    except IntegrityError:
        if not clave:
            raise

        existente = (
            RecepcionCompra.objects
            .filter(clave_idempotencia=clave)
            .first()
        )

        if existente is None:
            raise

        _validar_idempotencia_recepcion(
            existente,
            hash_solicitud,
        )
        return existente

    productos_recibidos = set()
    pares_asignados = set()
    ids_linea = [int(linea["detalle_compra_id"]) for linea in lineas]

    if len(ids_linea) != len(set(ids_linea)):
        raise ReglaNegocioError(
            "No se puede repetir una línea de compra en la recepción."
        )

    for linea in sorted(
        lineas,
        key=lambda item: int(item["detalle_compra_id"]),
    ):
        detalle_compra = (
            DetalleCompra.objects
            .select_for_update()
            .select_related("presentacion")
            .filter(
                pk=linea["detalle_compra_id"],
                compra=compra,
            )
            .first()
        )

        if detalle_compra is None:
            raise ReglaNegocioError(
                "La línea de compra indicada no existe."
            )

        cantidad = int(linea["cantidad"])

        if cantidad <= 0:
            raise ReglaNegocioError(
                "La cantidad recibida debe ser mayor a cero."
            )

        if cantidad > detalle_compra.cantidad_pendiente:
            raise ReglaNegocioError(
                "La cantidad recibida supera lo pendiente de la compra."
            )

        detalle_compra.cantidad_recibida += cantidad
        detalle_compra.save(update_fields=["cantidad_recibida"])
        productos_recibidos.add(
            detalle_compra.presentacion.producto_id
        )

        DetalleRecepcionCompra.objects.create(
            recepcion=recepcion,
            detalle_compra=detalle_compra,
            cantidad=cantidad,
            costo_unitario=detalle_compra.costo_unitario,
        )

        asignaciones = linea.get("asignaciones") or []
        total_asignado = sum(
            int(asignacion["cantidad"])
            for asignacion in asignaciones
        )

        if total_asignado > cantidad:
            raise ReglaNegocioError(
                "Las asignaciones superan la cantidad recibida en esta "
                "recepción."
            )

        for asignacion in asignaciones:
            detalle_pedido_id = int(
                asignacion["detalle_pedido_id"]
            )
            cantidad_asignada = int(asignacion["cantidad"])
            par = (detalle_compra.id, detalle_pedido_id)

            if par in pares_asignados:
                raise ReglaNegocioError(
                    "No se puede repetir una asignación en la misma "
                    "recepción."
                )

            pares_asignados.add(par)

            detalle_pedido = (
                DetallePedido.objects
                .select_for_update(of=("self",))
                .select_related(
                    "pedido",
                    "producto",
                    "presentacion__producto",
                )
                .filter(pk=detalle_pedido_id)
                .first()
            )

            if detalle_pedido is None:
                raise ReglaNegocioError(
                    "La línea de pedido indicada no existe."
                )

            if detalle_pedido.pedido_id not in pedidos_bloqueados:
                raise ReglaNegocioError(
                    "El pedido de la asignación no está disponible."
                )

            _asignar_detalle_compra(
                detalle_compra=detalle_compra,
                detalle_pedido=detalle_pedido,
                cantidad=cantidad_asignada,
                usuario=usuario,
            )

        total_asignado_lote = (
            AsignacionCompraPedido.objects
            .filter(
                detalle_compra=detalle_compra,
                liberada_en__isnull=True,
            )
            .aggregate(total=Sum("cantidad"))["total"]
            or 0
        )

        if total_asignado_lote > detalle_compra.cantidad_recibida:
            raise ReglaNegocioError(
                "Las asignaciones superan las unidades recibidas del "
                "lote de compra."
            )

    if productos_recibidos:
        from apps.pedidos.services.cierre import (
            reconciliar_pedidos_por_comprar,
        )
        from apps.finanzas.services.ventas import (
            reconciliar_ventas_pendientes,
        )

        reconciliar_pedidos_por_comprar(
            usuario=usuario,
            producto_ids=productos_recibidos,
        )
        reconciliar_ventas_pendientes(
            usuario=usuario,
            producto_ids=productos_recibidos,
        )

    return recepcion
