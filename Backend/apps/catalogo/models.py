
from decimal import Decimal

from django.core.validators import MinValueValidator
from django.db import models


class Categoria(models.Model):
    """
    Público objetivo principal del producto: Mujer, Hombre o Unisex.
    Se conserva el nombre Categoria por compatibilidad con la API.
    """

    nombre = models.CharField(max_length=100, unique=True)

    class Meta:
        ordering = ["nombre"]
        verbose_name_plural = "Categorías"

    def __str__(self):
        return self.nombre


class FamiliaOlfativa(models.Model):
    nombre = models.CharField(max_length=100, unique=True)

    class Meta:
        ordering = ["nombre"]
        verbose_name_plural = "Familias olfativas"

    def __str__(self):
        return self.nombre


class Producto(models.Model):
    categoria = models.ForeignKey(
        Categoria,
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="productos",
    )
    familias_olfativas = models.ManyToManyField(
        FamiliaOlfativa,
        blank=True,
        related_name="productos",
    )
    nombre = models.CharField(max_length=150)
    descripcion = models.TextField(blank=True)
    foto = models.ImageField(
        upload_to="productos/",
        blank=True,
        null=True,
    )

    # Precio publicado en el catálogo.
    # Se permite NULL temporalmente para migrar productos existentes.
    precio = models.DecimalField(
        max_digits=12,
        decimal_places=2,
        null=True,
        blank=True,
        validators=[MinValueValidator(Decimal("0.01"))],
    )

    # Contenido comercial del perfume en mililitros. Cada presentación
    # comercial (30 ml, 100 ml, etc.) es un Producto independiente.
    # Se permite NULL para no romper productos históricos.
    contenido_ml = models.PositiveIntegerField(
        null=True,
        blank=True,
        validators=[MinValueValidator(1)],
    )

    dias_entrega = models.PositiveSmallIntegerField(default=1)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["nombre"]

    def __str__(self):
        return self.nombre


class PresentacionProducto(models.Model):
    """
    Configuración interna de porcentajes de recarga por producto.

    No es una presentación comercial y no se expone en el catálogo
    público. `es_personalizada` se conserva por compatibilidad con
    datos anteriores; la lógica actual usa el porcentaje y la decisión
    de recarga registrada en el pedido.
    """

    PORCENTAJES = [
        (40, "40%"),
        (60, "60%"),
        (70, "70%"),
        (80, "80%"),
    ]

    producto = models.ForeignKey(
        Producto,
        on_delete=models.CASCADE,
        related_name="presentaciones",
    )
    porcentaje = models.PositiveSmallIntegerField(
        choices=PORCENTAJES,
    )
    # Campo legado. La lógica actual de recarga usa el porcentaje y
    # la decisión registrada en DetallePedido.
    es_personalizada = models.BooleanField(default=False)
    activo = models.BooleanField(default=True)

    class Meta:
        ordering = ["producto__nombre", "porcentaje"]
        constraints = [
            models.UniqueConstraint(
                fields=["producto", "porcentaje"],
                name="uq_producto_porcentaje",
            )
        ]

    def __str__(self):
        return f"{self.producto.nombre} - {self.porcentaje}%"
