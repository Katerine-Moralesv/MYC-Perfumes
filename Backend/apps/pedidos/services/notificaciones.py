"""
Compatibilidad del punto de integración existente.

La implementación vive en `apps.whatsapp.services.notificaciones`
para mantener el historial y la integración desacoplados.
"""

from apps.whatsapp.services.notificaciones import (  # noqa: F401
    construir_mensaje_nuevo_pedido,
    notificar_pedido_creado,
)
