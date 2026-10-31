import logging
from decimal import Decimal, ROUND_HALF_UP

from django.conf import settings
from django.db.models import F
from django.utils import timezone

from apps.core.services.whatsapp import (
    WhatsAppAuthError,
    WhatsAppConnectionError,
    WhatsAppError,
    WhatsAppHTTPError,
    WhatsAppNotConfigured,
    WhatsAppRateLimitError,
    enviar_mensaje_whatsapp,
)
from apps.pedidos.models import Pedido
from apps.whatsapp.models import NotificacionWhatsApp


logger = logging.getLogger(__name__)


def _formatear_monto(valor):
    monto = Decimal(valor or 0).quantize(
        Decimal("1"),
        rounding=ROUND_HALF_UP,
    )

    return f"${monto:,.0f} COP".replace(",", ".")


def _plural(cantidad, singular, plural):
    return singular if cantidad == 1 else plural


def _obtener_detalles(pedido):
    return list(
        pedido.detalles
        .select_related(
            "producto",
            "presentacion__producto",
        )
        .order_by("id")
    )


def _nombre_producto(detalle):
    producto = detalle.producto

    if producto is None and detalle.presentacion_id:
        producto = detalle.presentacion.producto

    return producto.nombre if producto else "Producto"


def _componer_lineas(detalles):
    lineas_texto = []
    lineas_plantilla = []

    for detalle in detalles:
        etiqueta = (
            f"{_nombre_producto(detalle)} "
            f"({detalle.porcentaje_recarga}%) "
            f"x{detalle.cantidad}"
        )

        if detalle.precio_pendiente:
            lineas_texto.append(
                f"- {etiqueta} - precio por definir"
            )
            lineas_plantilla.append(
                f"{etiqueta}: precio por definir"
            )
        else:
            monto = _formatear_monto(detalle.subtotal)
            lineas_texto.append(f"- {etiqueta} - {monto}")
            lineas_plantilla.append(f"{etiqueta}: {monto}")

    return (
        "\n".join(lineas_texto),
        "; ".join(lineas_plantilla),
    )


def _fecha_hora_pedido(pedido):
    if not pedido.creado_en:
        return "Sin fecha"

    return timezone.localtime(pedido.creado_en).strftime(
        "%d/%m/%Y %H:%M"
    )


def _construir_contenido(pedido):
    detalles = _obtener_detalles(pedido)
    lineas_texto, lineas_plantilla = _componer_lineas(detalles)

    numero_lineas = len(detalles)
    unidades = sum(detalle.cantidad for detalle in detalles)
    resumen = (
        f"{numero_lineas} "
        f"{_plural(numero_lineas, 'línea', 'líneas')} "
        f"({unidades} "
        f"{_plural(unidades, 'unidad', 'unidades')})"
    )

    total = _formatear_monto(pedido.total)
    hay_precios_pendientes = any(
        detalle.precio_pendiente for detalle in detalles
    )
    total_texto = (
        f"Total provisional: {total} "
        "(hay precios por definir)"
        if hay_precios_pendientes
        else f"Total: {total}"
    )

    cliente = (
        pedido.cliente.nombre.strip()
        if pedido.cliente and pedido.cliente.nombre
        else "Cliente"
    )
    fecha_hora = _fecha_hora_pedido(pedido)

    mensaje = (
        "Nuevo pedido en MYC Perfumes\n\n"
        f"Pedido: #{pedido.id}\n"
        f"Cliente: {cliente}\n"
        f"Fecha: {fecha_hora}\n"
        f"Productos: {resumen}\n"
        f"{lineas_texto}\n"
        f"{total_texto}\n\n"
        "Consulta los detalles en el panel administrativo de MYC."
    )

    parametros_plantilla = [
        f"#{pedido.id}",
        cliente,
        (
            f"{resumen}: {lineas_plantilla}"
            if lineas_plantilla
            else resumen
        ),
        total_texto,
        fecha_hora,
    ]

    return mensaje, parametros_plantilla


def construir_mensaje_nuevo_pedido(pedido):
    return _construir_contenido(pedido)[0]


def _whatsapp_habilitado():
    return bool(
        getattr(settings, "WHATSAPP_ENABLED", False)
    )


def _marcar_error(notificacion, codigo, mensaje):
    NotificacionWhatsApp.objects.filter(
        pk=notificacion.pk
    ).update(
        estado=NotificacionWhatsApp.Estado.ERROR,
        codigo_error=codigo[:50],
        ultimo_error=mensaje[:500],
    )


def _marcar_enviada(notificacion, respuesta):
    mensajes = (
        respuesta.get("messages")
        if isinstance(respuesta, dict)
        else None
    )

    if not isinstance(mensajes, list) or not mensajes:
        raise WhatsAppError(
            "La API de WhatsApp no confirmó el mensaje."
        )

    mensaje_id = str(
        mensajes[0].get("id", "")
        if isinstance(mensajes[0], dict)
        else ""
    ).strip()

    if not mensaje_id:
        raise WhatsAppError(
            "La API de WhatsApp no devolvió el identificador del mensaje."
        )

    NotificacionWhatsApp.objects.filter(
        pk=notificacion.pk
    ).update(
        estado=NotificacionWhatsApp.Estado.ENVIADO,
        proveedor_mensaje_id=mensaje_id[:255],
        codigo_error="",
        ultimo_error="",
        enviado_en=timezone.now(),
    )


def notificar_pedido_creado(pedido_id):
    """
    Notifica una única vez al administrador sobre un pedido creado.

    El historial persistente por pedido evita duplicados incluso entre
    procesos. Cualquier error queda aislado del flujo comercial.
    """

    if not _whatsapp_habilitado():
        logger.info(
            "Notificaciones de WhatsApp deshabilitadas; "
            "se omite el pedido %s.",
            pedido_id,
        )
        return False

    try:
        pedido = (
            Pedido.objects
            .select_related("cliente")
            .prefetch_related(
                "detalles__producto",
                "detalles__presentacion__producto",
            )
            .get(pk=pedido_id)
        )
    except Pedido.DoesNotExist:
        logger.warning(
            "No se encontró el pedido %s para notificar por WhatsApp.",
            pedido_id,
        )
        return False

    notificacion, creada = (
        NotificacionWhatsApp.objects.get_or_create(
            pedido=pedido,
            defaults={
                "estado": NotificacionWhatsApp.Estado.PENDIENTE,
            },
        )
    )

    if not creada:
        logger.info(
            "La notificación de WhatsApp del pedido %s ya fue "
            "procesada; se omite el duplicado.",
            pedido_id,
        )
        return False

    NotificacionWhatsApp.objects.filter(
        pk=notificacion.pk
    ).update(intentos=F("intentos") + 1)

    try:
        mensaje, parametros = _construir_contenido(pedido)
        respuesta = enviar_mensaje_whatsapp(
            mensaje,
            parametros_plantilla=parametros,
        )
        _marcar_enviada(notificacion, respuesta)
    except WhatsAppNotConfigured as exc:
        logger.warning(
            "WhatsApp no está configurado; no se notificó el "
            "pedido %s: %s",
            pedido_id,
            exc,
        )
        _marcar_error(
            notificacion,
            "no_configurado",
            "WhatsApp no está configurado.",
        )
        return False
    except WhatsAppAuthError:
        logger.error(
            "WhatsApp rechazó las credenciales para el pedido %s.",
            pedido_id,
        )
        _marcar_error(
            notificacion,
            "autenticacion",
            "Meta rechazó las credenciales o permisos.",
        )
        return False
    except WhatsAppRateLimitError:
        logger.error(
            "WhatsApp limitó los envíos para el pedido %s.",
            pedido_id,
        )
        _marcar_error(
            notificacion,
            "limite_envios",
            "Meta limitó temporalmente los envíos.",
        )
        return False
    except WhatsAppConnectionError:
        logger.error(
            "No se pudo conectar con WhatsApp para el pedido %s.",
            pedido_id,
        )
        _marcar_error(
            notificacion,
            "conexion",
            "No fue posible conectar con Meta.",
        )
        return False
    except WhatsAppHTTPError:
        logger.error(
            "WhatsApp respondió con error HTTP para el pedido %s.",
            pedido_id,
        )
        _marcar_error(
            notificacion,
            "http",
            "Meta respondió con un error HTTP.",
        )
        return False
    except WhatsAppError:
        logger.error(
            "La respuesta de WhatsApp no fue válida para el pedido %s.",
            pedido_id,
        )
        _marcar_error(
            notificacion,
            "respuesta_invalida",
            "La respuesta de Meta no confirmó el mensaje.",
        )
        return False
    except Exception as exc:
        logger.error(
            "Error inesperado al notificar por WhatsApp el pedido %s: %s",
            pedido_id,
            type(exc).__name__,
        )
        _marcar_error(
            notificacion,
            "inesperado",
            "Error inesperado durante la notificación.",
        )
        return False

    logger.info(
        "Notificación de WhatsApp enviada para el pedido %s.",
        pedido_id,
    )

    return True
