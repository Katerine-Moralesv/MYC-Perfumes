from django.conf import settings
from django.db import models


class DispositivoFCM(models.Model):
    class Plataforma(models.TextChoices):
        WEB = "web", "Web"
        ANDROID = "android", "Android"
        IOS = "ios", "iOS"

    usuario = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.CASCADE,
        related_name="dispositivos_fcm",
    )

    token = models.TextField(unique=True)

    plataforma = models.CharField(
        max_length=10,
        choices=Plataforma.choices,
        default=Plataforma.WEB,
    )

    activo = models.BooleanField(default=True)

    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-actualizado_en"]
        verbose_name = "Dispositivo FCM"
        verbose_name_plural = "Dispositivos FCM"

    def __str__(self):
        return f"{self.usuario} - {self.plataforma} (activo={self.activo})"
