import secrets

from django.contrib.auth.hashers import check_password, make_password
from django.contrib.auth.models import AbstractUser
from django.db import models
from django.utils import timezone


class Usuario(AbstractUser):

    class Rol(models.TextChoices):
        ADMIN = "admin", "Administrador"
        VENDEDOR = "vendedor", "Vendedor"

    rol = models.CharField(
        max_length=10,
        choices=Rol.choices,
        default=Rol.VENDEDOR,
    )

    def __str__(self):
        return self.username


class RecuperacionPassword(models.Model):
    """
    Gestiona una recuperación temporal de contraseña.

    Por seguridad:
    - El código de 6 dígitos se almacena únicamente como hash.
    - El token de restablecimiento también se almacena como hash.
    - La contraseña nunca se almacena aquí.
    """

    usuario = models.ForeignKey(
        Usuario,
        on_delete=models.CASCADE,
        related_name="recuperaciones_password",
    )

    codigo_hash = models.CharField(max_length=128)

    token_hash = models.CharField(
        max_length=128,
        blank=True,
        null=True,
    )

    creado_en = models.DateTimeField(auto_now_add=True)

    expira_en = models.DateTimeField()

    verificado_en = models.DateTimeField(
        blank=True,
        null=True,
    )

    usado_en = models.DateTimeField(
        blank=True,
        null=True,
    )

    intentos = models.PositiveSmallIntegerField(default=0)

    class Meta:
        ordering = ["-creado_en"]

    def codigo_valido(self, codigo):
        """
        Verifica que el código coincida y que la recuperación
        siga vigente y no haya sido utilizada.
        """

        if self.usado_en is not None:
            return False

        if self.verificado_en is not None:
            return False

        if timezone.now() >= self.expira_en:
            return False

        return check_password(codigo, self.codigo_hash)

    def token_valido(self, token):
        """
        Verifica que el token de recuperación sea válido.
        """

        if self.usado_en is not None:
            return False

        if self.verificado_en is None:
            return False

        if timezone.now() >= self.expira_en:
            return False

        if not self.token_hash:
            return False

        return check_password(token, self.token_hash)

    @staticmethod
    def generar_codigo():
        """
        Genera un código numérico de 6 dígitos.
        """

        return f"{secrets.randbelow(1_000_000):06d}"

    @staticmethod
    def generar_token():
        """
        Genera un token criptográficamente seguro.
        """

        return secrets.token_urlsafe(32)

    @classmethod
    def crear_recuperacion(
        cls,
        usuario,
        codigo,
        expira_en,
    ):
        """
        Crea una recuperación almacenando únicamente
        el hash del código.
        """

        return cls.objects.create(
            usuario=usuario,
            codigo_hash=make_password(codigo),
            expira_en=expira_en,
        )