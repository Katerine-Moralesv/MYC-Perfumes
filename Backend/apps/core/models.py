from django.conf import settings
from django.db import models


class ModeloAuditado(models.Model):
    """Abstracto: trazabilidad de quién y cuándo (cubre RF19)."""
    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        related_name="%(class)s_creados",
    )

    class Meta:
        abstract = True
