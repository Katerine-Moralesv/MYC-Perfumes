import logging

from apps.notificaciones.services.firebase_messaging import (
    enviar_notificacion_pedido,
)
from apps.pedidos.models import Pedido


logger = logging.getLogger(__name__)


def notificar_pedido_creado(pedido_id):
    """
    Punto de entrada seguro para transaction.on_commit.

    Cualquier error de Firebase queda contenido aquí: un fallo de
    notificación nunca revierte un pedido ya confirmado.
    """

    try:
        pedido = (
            Pedido.objects
            .select_related("cliente")
            .filter(pk=pedido_id)
            .first()
        )

        if pedido is None:
            return 0

        return enviar_notificacion_pedido(pedido)
    except Exception:
        logger.exception(
            "Error al notificar el pedido %s.",
            pedido_id,
        )
        return 0
