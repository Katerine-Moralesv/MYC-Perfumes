import logging
import threading
from decimal import Decimal

from django.conf import settings
from django.db import close_old_connections, transaction

from apps.core.exceptions import ReglaNegocioError
from apps.core.utils import normalizar_telefono
from apps.catalogo.repositories import (
    obtener_presentacion_activa,
    obtener_producto_activo,
)
from apps.pedidos.models import Pedido, DetallePedido
from apps.pedidos.repositories import (
    obtener_o_crear_cliente_por_telefono,
)


logger = logging.getLogger(__name__)

MAX_CANTIDAD_POR_LINEA = 100
PORCENTAJES_RECARGA = {60, 70, 80}


def _enviar_notificacion(pedido_id, *, cerrar_conexiones):
    try:
        if cerrar_conexiones:
            close_old_connections()

        from apps.pedidos.services.notificaciones import (
            notificar_pedido_creado,
        )

        notificar_pedido_creado(pedido_id)
    except Exception:
        logger.exception(
            "Error inesperado al notificar por WhatsApp el pedido %s.",
            pedido_id,
        )
    finally:
        if cerrar_conexiones:
            close_old_connections()


def _notificar_pedido_creado(pedido_id):
    if not getattr(settings, "WHATSAPP_ASYNC_ENABLED", False):
        _enviar_notificacion(
            pedido_id,
            cerrar_conexiones=False,
        )
        return

    hilo = threading.Thread(
        target=_enviar_notificacion,
        kwargs={
            "pedido_id": pedido_id,
            "cerrar_conexiones": True,
        },
        daemon=True,
        name=f"whatsapp-pedido-{pedido_id}",
    )
    hilo.start()


def _resolver_recarga(linea):
    """
    Devuelve (producto, presentacion, recarga_solicitada, porcentaje).

    El porcentaje es una elección del pedido. No se busca ni se crea
    una PresentacionProducto para 60/70/80. La presentación solo se
    conserva cuando el cliente usa el contrato legado con
    presentacion_id.
    """

    presentacion_id = linea.get("presentacion_id")
    producto_id = linea.get("producto_id")
    porcentaje = linea.get("porcentaje")
    recarga = linea.get("recarga_solicitada")

    if presentacion_id:
        presentacion = obtener_presentacion_activa(
            presentacion_id
        )

        if presentacion is None:
            raise ReglaNegocioError(
                "La presentación indicada no existe o está inactiva."
            )

        if (
            producto_id
            and presentacion.producto_id != producto_id
        ):
            raise ReglaNegocioError(
                "La presentación no pertenece al producto indicado."
            )

        if (
            porcentaje is not None
            and presentacion.porcentaje != porcentaje
        ):
            raise ReglaNegocioError(
                "El porcentaje no coincide con la presentación indicada."
            )

        if recarga is None:
            recarga = presentacion.porcentaje in PORCENTAJES_RECARGA
        elif recarga and presentacion.porcentaje not in PORCENTAJES_RECARGA:
            raise ReglaNegocioError(
                "La recarga solicitada debe ser 60%, 70% u 80%."
            )
        elif not recarga and presentacion.porcentaje != 40:
            raise ReglaNegocioError(
                "Si no se solicita recarga, el porcentaje debe ser 40%."
            )

        return (
            presentacion.producto,
            presentacion,
            bool(recarga),
            presentacion.porcentaje,
        )

    producto = obtener_producto_activo(producto_id)

    if producto is None:
        raise ReglaNegocioError(
            "El producto no existe o está inactivo."
        )

    if recarga is None:
        raise ReglaNegocioError(
            "Debes indicar si la clienta solicita recarga."
        )

    if recarga:
        if porcentaje not in PORCENTAJES_RECARGA:
            raise ReglaNegocioError(
                "Una recarga solicitada debe ser 60%, 70% u 80%."
            )

        porcentaje_final = porcentaje
    else:
        if porcentaje not in (None, 40):
            raise ReglaNegocioError(
                "Si no se solicita recarga, el porcentaje debe ser 40%."
            )

        porcentaje_final = 40

    return (
        producto,
        None,
        bool(recarga),
        porcentaje_final,
    )


@transaction.atomic
def registrar_pedido(
    *,
    telefono,
    nombre_cliente="",
    lineas,
    clave_idempotencia=None,
    hash_solicitud="",
):
    """
    Registra un pedido proveniente del bot de WhatsApp o de la tienda web.

    Este servicio NO crea ventas ni modifica dinero.
    El pedido queda pendiente hasta que un usuario autenticado
    lo confirme.
    """

    if not lineas:
        raise ReglaNegocioError(
            "El pedido debe tener al menos un producto."
        )

    telefono_normalizado = normalizar_telefono(
        telefono
    )

    if not telefono_normalizado:
        raise ReglaNegocioError(
            "El teléfono proporcionado no es válido."
        )

    cliente = obtener_o_crear_cliente_por_telefono(
        telefono_normalizado,
        nombre_cliente,
    )

    pedido = Pedido.objects.create(
        cliente=cliente,
        telefono_origen=telefono_normalizado,
        clave_idempotencia=clave_idempotencia,
        hash_solicitud=hash_solicitud,
    )

    detalles = []
    total = Decimal("0")
    claves_usadas = set()

    for linea in lineas:
        cantidad = linea["cantidad"]

        if cantidad <= 0:
            raise ReglaNegocioError(
                "La cantidad debe ser mayor a cero."
            )

        if cantidad > MAX_CANTIDAD_POR_LINEA:
            raise ReglaNegocioError(
                f"La cantidad máxima por línea es "
                f"{MAX_CANTIDAD_POR_LINEA}."
            )

        (
            producto,
            presentacion,
            recarga_solicitada,
            porcentaje_final,
        ) = _resolver_recarga(linea)

        clave = (
            producto.id,
            porcentaje_final,
        )

        if clave in claves_usadas:
            raise ReglaNegocioError(
                "No se puede repetir el mismo producto con el mismo "
                "porcentaje dentro del pedido."
            )

        claves_usadas.add(clave)

        if recarga_solicitada:
            # Las recargas 60/70/80 quedan pendientes de precio.
            precio_unitario = Decimal("0")
            precio_pendiente = True
        else:
            precio_catalogo = producto.precio

            if (
                precio_catalogo is None
                or precio_catalogo <= 0
            ):
                raise ReglaNegocioError(
                    "El producto "
                    f"'{producto.nombre}' no tiene "
                    "un precio de catálogo válido."
                )

            precio_unitario = precio_catalogo
            precio_pendiente = False

        detalles.append(
            DetallePedido(
                pedido=pedido,
                producto=producto,
                presentacion=presentacion,
                cantidad=cantidad,
                precio_unitario=precio_unitario,
                precio_pendiente=precio_pendiente,
                recarga_solicitada=recarga_solicitada,
                porcentaje_recarga=porcentaje_final,
            )
        )

        total += precio_unitario * cantidad

    DetallePedido.objects.bulk_create(
        detalles
    )

    pedido.total = total
    pedido.save(update_fields=["total"])

    transaction.on_commit(
        lambda: _notificar_pedido_creado(pedido.id)
    )

    return pedido
