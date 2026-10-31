import io
from datetime import date
from decimal import Decimal

from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import (
    Categoria,
    PresentacionProducto,
    Producto,
)
from apps.finanzas.models import (
    Compra,
    DetalleCompra,
    Proveedor,
)
from apps.finanzas.repositories import costo_unitario_vigente
from apps.usuarios.models import Usuario


class PresentacionesPredeterminadasTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_presentaciones_default",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cls.categoria = Categoria.objects.create(
            nombre="Categoría presentaciones default"
        )

    def test_producto_creado_por_api_tiene_cuatro_presentaciones(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/catalogo/productos/",
            {
                "categoria": self.categoria.id,
                "nombre": "Producto con presentaciones",
                "precio": "50000.00",
                "dias_entrega": 1,
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        porcentajes = set(
            PresentacionProducto.objects
            .filter(producto_id=respuesta.data["id"])
            .values_list("porcentaje", flat=True)
        )
        self.assertEqual(porcentajes, {40, 60, 70, 80})

    def test_comando_simula_por_defecto_y_completa_sin_sobrescribir(
        self,
    ):
        producto = Producto.objects.create(
            categoria=self.categoria,
            nombre="Producto histórico",
            precio=Decimal("80000.00"),
        )
        presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=40,
            activo=False,
        )
        proveedor = Proveedor.objects.create(
            nombre="Proveedor costo presentaciones"
        )
        compra = Compra.objects.create(
            proveedor=proveedor,
            fecha=date.today(),
            total=Decimal("12000.00"),
            registrado_por=self.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=presentacion,
            cantidad=1,
            cantidad_recibida=1,
            costo_unitario=Decimal("12000.00"),
        )

        call_command(
            "completar_presentaciones",
            stdout=io.StringIO(),
        )
        self.assertEqual(
            PresentacionProducto.objects.filter(
                producto=producto
            ).count(),
            1,
        )

        call_command(
            "completar_presentaciones",
            "--apply",
            stdout=io.StringIO(),
        )
        call_command(
            "completar_presentaciones",
            "--apply",
            stdout=io.StringIO(),
        )

        porcentajes = set(
            PresentacionProducto.objects
            .filter(producto=producto)
            .values_list("porcentaje", flat=True)
        )
        self.assertEqual(porcentajes, {40, 60, 70, 80})
        self.assertEqual(
            PresentacionProducto.objects.filter(
                producto=producto
            ).count(),
            4,
        )

        presentacion.refresh_from_db()
        self.assertFalse(presentacion.activo)
        self.assertEqual(
            costo_unitario_vigente(presentacion.id),
            Decimal("12000.00"),
        )

        producto.refresh_from_db()
        self.assertEqual(producto.nombre, "Producto histórico")
