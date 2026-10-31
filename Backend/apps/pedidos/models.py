from decimal import Decimal

from django.conf import settings
from django.core.validators import MinValueValidator
from django.db import models
from django.db.models import F, Q


class Pedido(models.Model):
    class Estado(models.TextChoices):
        PENDIENTE = "pendiente", "Pendiente"
        CONFIRMADO = "confirmado", "Confirmado"
        POR_COMPRAR = "por_comprar", "Por comprar"
        COMPRADO = "comprado", "Comprado"
        PREPARANDO = "preparando", "Preparando"
        LISTO = "listo", "Listo"
        ENTREGADO = "entregado", "Entregado"
        CANCELADO = "cancelado", "Cancelado"
        RECHAZADO = "rechazado", "Rechazado"

    cliente = models.ForeignKey(
        "finanzas.Cliente", on_delete=models.PROTECT, related_name="pedidos"
    )
    telefono_origen = models.CharField(max_length=20)
    estado = models.CharField(max_length=12, choices=Estado.choices, default=Estado.PENDIENTE)

    # Total provisional mientras haya líneas pendientes de precio.
    # Al confirmar se reemplaza por el total definitivo.
    total = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
    )

    # Se llena solo cuando se confirma (RF16): un pedido confirmado = una venta.
    venta = models.OneToOneField(
        "finanzas.Venta", on_delete=models.PROTECT, null=True, blank=True, related_name="pedido_origen"
    )

    confirmado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL, on_delete=models.PROTECT,
        null=True, blank=True, related_name="pedidos_gestionados"
    )
    motivo_rechazo = models.CharField(max_length=255, blank=True)

    cancelado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="pedidos_cancelados",
    )
    motivo_cancelacion = models.CharField(max_length=255, blank=True)
    cancelado_en = models.DateTimeField(null=True, blank=True)

    entregado_en = models.DateTimeField(null=True, blank=True)
    entregado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="pedidos_entregados",
    )

    # Clave técnica para idempotencia de la tienda web. Los pedidos
    # creados por el webhook o por otros medios pueden dejarla vacía.
    # El hash permite detectar la reutilización de una clave con un
    # contenido distinto sin exponer el payload original.
    clave_idempotencia = models.CharField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        editable=False,
    )
    hash_solicitud = models.CharField(
        max_length=64,
        blank=True,
        default="",
        editable=False,
    )

    creado_en = models.DateTimeField(auto_now_add=True)
    actualizado_en = models.DateTimeField(auto_now=True)

    class Meta:
        ordering = ["-creado_en"]
        indexes = [models.Index(fields=["estado"])]

    @property
    def monto_pagado(self):
        if self.venta_id:
            abonos = self.venta.abonos.all()
        else:
            abonos = self.abonos.all()

        return sum(
            (abono.monto for abono in abonos),
            Decimal("0.00"),
        )

    @property
    def saldo_estimado(self):
        saldo = (self.total or Decimal("0.00")) - self.monto_pagado
        return max(saldo, Decimal("0.00"))

    def __str__(self):
        return f"Pedido #{self.pk} ({self.estado}) - {self.cliente.nombre}"


class DetallePedido(models.Model):
    pedido = models.ForeignKey(Pedido, on_delete=models.CASCADE, related_name="detalles")
    producto = models.ForeignKey(
        "catalogo.Producto",
        on_delete=models.PROTECT,
        related_name="detalles_pedido",
        null=True,
        blank=True,
    )
    # Se conserva para pedidos antiguos y para la resolución de costos
    # cuando el administrador haya configurado ese porcentaje. Los
    # pedidos nuevos no dependen de que exista una presentación.
    presentacion = models.ForeignKey(
        "catalogo.PresentacionProducto",
        on_delete=models.PROTECT,
        related_name="+",
        null=True,
        blank=True,
    )
    cantidad = models.PositiveIntegerField(validators=[MinValueValidator(1)])

    # Copia del precio aplicado a esta operación. Nunca se lee
    # nuevamente del catálogo para pedidos ya creados.
    precio_unitario = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        default=Decimal("0"),
    )

    # Solo es True para recargas 60/70/80 cuyo precio final aún no
    # ha sido definido por el administrador.
    precio_pendiente = models.BooleanField(default=False)

    # Indica si la clienta solicitó expresamente una recarga. El 40%
    # se usa automáticamente cuando no se solicita recarga.
    recarga_solicitada = models.BooleanField(default=False)

    # Porcentaje final aplicado a la línea. Se guarda como snapshot
    # independientemente de la configuración interna del producto.
    porcentaje_recarga = models.PositiveSmallIntegerField(
        choices=[
            (40, "40%"),
            (60, "60%"),
            (70, "70%"),
            (80, "80%"),
        ],
        default=40,
    )

    cantidad_recibida = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )

    # Costo real asignado desde una o varias compras. Se conserva como
    # snapshot de la operación y nunca se toma del costo "vigente" global.
    costo_unitario_real = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
    )

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=Q(cantidad_recibida__lte=F("cantidad")),
                name="ck_detallepedido_recibido_lte_cantidad",
            ),
            models.CheckConstraint(
                condition=(
                    Q(costo_unitario_real__isnull=True)
                    | Q(costo_unitario_real__gte=0)
                ),
                name="ck_detallepedido_costo_no_negativo",
            ),
        ]

    @property
    def subtotal(self):
        return self.precio_unitario * self.cantidad

    @property
    def cantidad_pendiente(self):
        return max(self.cantidad - self.cantidad_recibida, 0)

    @property
    def cantidad_cubierta(self):
        return self.cantidad_recibida

    @property
    def tiene_costo_real(self):
        return (
            self.costo_unitario_real is not None
            and self.costo_unitario_real >= 0
        )

    def __str__(self):
        producto = self.producto

        if producto is None and self.presentacion is not None:
            producto = self.presentacion.producto

        nombre = producto.nombre if producto else "Producto"

        return (
            f"{nombre} - {self.porcentaje_recarga}% "
            f"x{self.cantidad} (pedido #{self.pedido_id})"
        )

class HistorialEstadoPedido(models.Model):
    pedido = models.ForeignKey(
        Pedido,
        on_delete=models.CASCADE,
        related_name="historial_estados",
    )
    estado_anterior = models.CharField(
        max_length=12,
        choices=Pedido.Estado.choices,
        blank=True,
    )
    estado_nuevo = models.CharField(
        max_length=12,
        choices=Pedido.Estado.choices,
    )
    motivo = models.CharField(max_length=255, blank=True)
    registrado_por = models.ForeignKey(
        settings.AUTH_USER_MODEL,
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="historial_pedidos_registrados",
    )
    creado_en = models.DateTimeField(auto_now_add=True)

    class Meta:
        ordering = ["creado_en", "id"]
        verbose_name_plural = "Historial de estados de pedidos"

    def __str__(self):
        return (
            f"Pedido #{self.pedido_id}: "
            f"{self.estado_anterior or 'inicio'} -> {self.estado_nuevo}"
        )
