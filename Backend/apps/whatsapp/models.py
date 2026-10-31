from django.db import models


class NotificacionWhatsApp(models.Model):
    """Historial persistente de notificaciones enviadas por pedido."""

    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        ENVIADO = "enviado", "Enviado"
        ERROR = "error", "Error"

    pedido = models.OneToOneField(
        "pedidos.Pedido",
        on_delete=models.CASCADE,
        related_name="notificacion_whatsapp",
    )
    estado = models.CharField(
        max_length=10,
        choices=Estado.choices,
        default=Estado.PENDIENTE,
    )
    intentos = models.PositiveSmallIntegerField(default=0)
    proveedor_mensaje_id = models.CharField(
        max_length=255,
        blank=True,
        default="",
    )
    codigo_error = models.CharField(
        max_length=50,
        blank=True,
        default="",
    )
    ultimo_error = models.CharField(
        max_length=500,
        blank=True,
        default="",
    )
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)
    enviado_en = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-creado_en", "-id"]
        verbose_name = "Notificación WhatsApp"
        verbose_name_plural = "Notificaciones WhatsApp"

    def __str__(self):
        return (
            f"Pedido #{self.pedido_id} - "
            f"{self.get_estado_display()}"
        )
