from decimal import Decimal
from django.core.validators import MinValueValidator
from django.db import models

from apps.core.models import ModeloAuditado


class Proveedor(models.Model):
    nombre = models.CharField(max_length=150)
    telefono = models.CharField(max_length=20, blank=True)
    notas = models.TextField(blank=True)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


class Cliente(models.Model):
    nombre = models.CharField(max_length=150)
    telefono = models.CharField(max_length=20, blank=True)
    notas = models.TextField(blank=True)

    class Meta:
        ordering = ["nombre"]
        indexes = [models.Index(fields=["telefono"])]

    def __str__(self):
        return self.nombre


class Compra(ModeloAuditado):
    proveedor = models.ForeignKey(Proveedor, on_delete=models.PROTECT, related_name="compras")
    fecha = models.DateField()
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
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

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"Compra #{self.pk} - {self.proveedor.nombre}"


class DetalleCompra(models.Model):
    compra = models.ForeignKey(Compra, on_delete=models.CASCADE, related_name="detalles")
    presentacion = models.ForeignKey("catalogo.PresentacionProducto", on_delete=models.PROTECT, related_name="+")
    cantidad = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    costo_unitario = models.DecimalField(max_digits=12, decimal_places=2)
    cantidad_recibida = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(fields=["compra", "presentacion"], name="uq_detalle_compra_presentacion"),
            models.CheckConstraint(
                condition=models.Q(cantidad_recibida__lte=models.F("cantidad")),
                name="ck_detallecompra_recibida_lte_cantidad",
            ),
        ]

    @property
    def subtotal(self):
        return self.costo_unitario * self.cantidad

    @property
    def cantidad_pendiente(self):
        return max(self.cantidad - self.cantidad_recibida, 0)

    def __str__(self):
        return f"{self.presentacion} x{self.cantidad} (compra #{self.compra_id})"


class RecepcionCompra(ModeloAuditado):
    """
    Recepción física de una o varias líneas de una compra.

    Comprar no equivale a recibir. La recepción es la operación que
    incrementa existencias y puede cubrir pedidos.
    """

    compra = models.ForeignKey(
        Compra,
        on_delete=models.PROTECT,
        related_name="recepciones",
    )
    fecha = models.DateField()
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

    class Meta:
        ordering = ["-fecha", "-id"]

    def __str__(self):
        return f"Recepción #{self.pk} de compra #{self.compra_id}"


class DetalleRecepcionCompra(models.Model):
    recepcion = models.ForeignKey(
        RecepcionCompra,
        on_delete=models.CASCADE,
        related_name="detalles",
    )
    detalle_compra = models.ForeignKey(
        DetalleCompra,
        on_delete=models.PROTECT,
        related_name="recepciones",
    )
    cantidad = models.PositiveIntegerField(
        validators=[MinValueValidator(1)]
    )
    costo_unitario = models.DecimalField(
        max_digits=12,
        decimal_places=2,
    )

    class Meta:
        constraints = [
            models.UniqueConstraint(
                fields=["recepcion", "detalle_compra"],
                name="uq_recepcion_detalle_compra",
            ),
        ]

    @property
    def subtotal(self):
        return self.costo_unitario * self.cantidad

    def __str__(self):
        return (
            f"Recepción #{self.recepcion_id} - "
            f"detalle compra #{self.detalle_compra_id} "
            f"x{self.cantidad}"
        )


class AsignacionCompraPedido(ModeloAuditado):
    """
    Trazabilidad explícita entre una compra real y una línea de pedido.

    La asignación congela el costo unitario de la compra. Una misma
    compra puede cubrir varias líneas de pedido, pero cada unidad se
    asigna una sola vez y no se duplica el costo.
    """

    detalle_compra = models.ForeignKey(
        DetalleCompra,
        on_delete=models.CASCADE,
        related_name="asignaciones",
    )
    detalle_pedido = models.ForeignKey(
        "pedidos.DetallePedido",
        on_delete=models.PROTECT,
        related_name="asignaciones_compra",
    )
    cantidad = models.PositiveIntegerField(
        validators=[MinValueValidator(1)]
    )
    costo_unitario = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    liberada_en = models.DateTimeField(null=True, blank=True)
    liberada_por = models.ForeignKey(
        "usuarios.Usuario",
        on_delete=models.PROTECT,
        null=True,
        blank=True,
        related_name="asignaciones_inventario_liberadas",
    )

    class Meta:
        ordering = ["detalle_pedido_id", "id"]
        constraints = [
            models.UniqueConstraint(
                fields=["detalle_compra", "detalle_pedido"],
                condition=models.Q(liberada_en__isnull=True),
                name="uq_asignacion_compra_detalle_pedido_activa",
            ),
        ]
        indexes = [
            models.Index(
                fields=["detalle_pedido"],
                name="finanzas_asig_pedido_idx",
            ),
            models.Index(
                fields=["detalle_compra", "liberada_en"],
                name="finanzas_asig_lote_activa_idx",
            ),
        ]

    @property
    def activa(self):
        return self.liberada_en is None

    @property
    def subtotal(self):
        return self.costo_unitario * self.cantidad

    def __str__(self):
        return (
            f"Compra #{self.detalle_compra.compra_id} -> "
            f"pedido #{self.detalle_pedido.pedido_id} "
            f"x{self.cantidad}"
        )


class Venta(ModeloAuditado):
    class EstadoPago(models.TextChoices):
        PAGADO = "pagado", "Pagado"
        ABONADO = "abonado", "Abonado"
        PENDIENTE = "pendiente", "Pendiente"

    cliente = models.ForeignKey(Cliente, on_delete=models.PROTECT, related_name="ventas")
    fecha = models.DateField()
    estado_pago = models.CharField(max_length=10, choices=EstadoPago.choices, default=EstadoPago.PENDIENTE)
    total = models.DecimalField(max_digits=12, decimal_places=2, default=0)
    saldo = models.DecimalField(max_digits=12, decimal_places=2, default=0)
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

    class Meta:
        ordering = ["-fecha", "-id"]
        indexes = [
            models.Index(fields=["estado_pago"]),
            models.Index(fields=["cliente", "estado_pago"]),
        ]

    @property
    def ganancia(self):
        return sum((d.ganancia for d in self.detalles.all()), start=0)

    @property
    def unidades_pendientes_abastecimiento(self):
        return sum(
            detalle.cantidad_pendiente
            for detalle in self.detalles.all()
        )

    @property
    def estado_abastecimiento(self):
        detalles = list(self.detalles.all())

        if not detalles or all(
            detalle.cantidad_pendiente == 0
            for detalle in detalles
        ):
            return "completo"

        if all(
            detalle.cantidad_pendiente == detalle.cantidad
            for detalle in detalles
        ):
            return "pendiente"

        return "parcial"

    def __str__(self):
        return f"Venta #{self.pk} - {self.cliente.nombre}"


class DetalleVenta(models.Model):
    venta = models.ForeignKey(Venta, on_delete=models.CASCADE, related_name="detalles")
    presentacion = models.ForeignKey("catalogo.PresentacionProducto", on_delete=models.PROTECT, related_name="+")
    cantidad = models.PositiveIntegerField(validators=[MinValueValidator(1)])
    cantidad_pendiente = models.PositiveIntegerField(
        default=0,
        validators=[MinValueValidator(0)],
    )
    precio_venta = models.DecimalField(max_digits=12, decimal_places=2)
    costo_unitario = models.DecimalField(max_digits=12, decimal_places=2)

    class Meta:
        constraints = [
            models.CheckConstraint(
                condition=models.Q(
                    cantidad_pendiente__lte=models.F("cantidad")
                ),
                name="ck_detalleventa_pendiente_lte_cantidad",
            ),
        ]
        indexes = [
            models.Index(
                fields=["presentacion", "cantidad_pendiente"],
                name="finanzas_detventa_pend_idx",
            ),
        ]

    @property
    def cantidad_cubierta(self):
        return max(self.cantidad - self.cantidad_pendiente, 0)

    @property
    def subtotal(self):
        return self.precio_venta * self.cantidad

    @property
    def ganancia(self):
        return (
            self.precio_venta - self.costo_unitario
        ) * self.cantidad_cubierta

    def __str__(self):
        return f"{self.presentacion} x{self.cantidad} (venta #{self.venta_id})"


class Abono(models.Model):
    class Tipo(models.TextChoices):
        ANTICIPO = "anticipo", "Anticipo"
        INICIAL = "inicial", "Inicial"
        POSTERIOR = "posterior", "Posterior"

    venta = models.ForeignKey(
        Venta,
        on_delete=models.PROTECT,
        related_name="abonos",
        null=True,
        blank=True,
    )
    pedido = models.ForeignKey(
        "pedidos.Pedido",
        on_delete=models.PROTECT,
        related_name="abonos",
        null=True,
        blank=True,
    )
    monto = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    fecha = models.DateField()
    creado_en = models.DateTimeField(auto_now_add=True, null=True)
    tipo = models.CharField(
        max_length=10,
        choices=Tipo.choices,
        null=True,
        blank=True,
    )
    metodo_pago = models.CharField(max_length=30, blank=True)
    referencia = models.CharField(max_length=120, blank=True)
    clave_idempotencia = models.CharField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        editable=False,
    )
    registrado_por = models.ForeignKey(
        "usuarios.Usuario", on_delete=models.PROTECT, related_name="abonos_registrados"
    )

    class Meta:
        ordering = ["-fecha", "-id"]
        indexes = [
            models.Index(fields=["fecha"], name="finanzas_abono_fecha_idx"),
            models.Index(
                fields=["pedido", "fecha"],
                name="finanzas_abono_pedido_idx",
            ),
        ]
        constraints = [
            models.UniqueConstraint(
                fields=["venta"],
                condition=models.Q(tipo="inicial"),
                name="uq_abono_inicial_por_venta",
            ),
            models.CheckConstraint(
                condition=(
                    models.Q(venta__isnull=False)
                    | models.Q(pedido__isnull=False)
                ),
                name="ck_abono_venta_o_pedido",
            ),
        ]

    def __str__(self):
        destino = (
            f"venta #{self.venta_id}"
            if self.venta_id
            else f"pedido #{self.pedido_id}"
        )
        return f"Abono {self.monto} a {destino}"


class Devolucion(ModeloAuditado):
    """
    Registro de devolución de dinero al cliente.

    No elimina ni modifica el abono, la venta ni la compra originales.
    Para devoluciones posteriores a la venta, este registro permite
    conciliar la salida de caja sin reescribir el histórico.
    """

    pedido = models.ForeignKey(
        "pedidos.Pedido",
        on_delete=models.PROTECT,
        related_name="devoluciones",
    )
    venta = models.ForeignKey(
        Venta,
        on_delete=models.PROTECT,
        related_name="devoluciones",
        null=True,
        blank=True,
    )
    abono = models.ForeignKey(
        Abono,
        on_delete=models.PROTECT,
        related_name="devoluciones",
        null=True,
        blank=True,
    )
    monto = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        validators=[MinValueValidator(Decimal("0.01"))],
    )
    fecha = models.DateField()
    metodo_pago = models.CharField(max_length=30, blank=True)
    referencia = models.CharField(max_length=120, blank=True)
    motivo = models.CharField(max_length=255, blank=True)
    clave_idempotencia = models.CharField(
        max_length=64,
        unique=True,
        null=True,
        blank=True,
        editable=False,
    )

    class Meta:
        ordering = ["-fecha", "-id"]
        indexes = [
            models.Index(
                fields=["pedido", "fecha"],
                name="finanzas_devol_pedido_idx",
            ),
            models.Index(
                fields=["fecha"],
                name="finanzas_devol_fecha_idx",
            ),
        ]

    def __str__(self):
        return f"Devolución {self.monto} - pedido #{self.pedido_id}"
