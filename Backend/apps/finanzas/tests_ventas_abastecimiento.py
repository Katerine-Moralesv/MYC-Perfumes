from datetime import date, timedelta
from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import Categoria, PresentacionProducto, Producto
from apps.finanzas.models import Cliente, Compra, Proveedor, Venta
from apps.finanzas.serializers import VentaSerializer
from apps.finanzas.services.compras import (
    registrar_compra,
    registrar_recepcion,
)
from apps.finanzas.services.inventario import disponibilidad_producto
from apps.finanzas.services.ventas import registrar_venta
from apps.usuarios.models import Usuario


class VentasAbastecimientoTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_ventas_abastecimiento",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(
            nombre="Ventas abastecimiento"
        )
        cls.producto = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume venta manual",
            precio=Decimal("150000.00"),
            contenido_ml=100,
        )
        cls.presentacion = PresentacionProducto.objects.create(
            producto=cls.producto,
            porcentaje=40,
            activo=True,
        )
        cls.presentacion_70 = PresentacionProducto.objects.create(
            producto=cls.producto,
            porcentaje=70,
            activo=True,
        )
        cls.cliente = Cliente.objects.create(
            nombre="Clienta venta manual",
            telefono="3007000001",
        )
        cls.proveedor = Proveedor.objects.create(
            nombre="Proveedor venta manual",
        )

    def _stock(self, cantidad, presentacion=None, costo="40000.00"):
        return registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=[
                {
                    "presentacion_id": (
                        presentacion or self.presentacion
                    ).id,
                    "cantidad": cantidad,
                    "cantidad_recibida": cantidad,
                    "costo_unitario": Decimal(costo),
                }
            ],
            usuario=self.admin,
        )

    def _compra_pendiente(self, cantidad, presentacion=None):
        compra = registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=[
                {
                    "presentacion_id": (
                        presentacion or self.presentacion
                    ).id,
                    "cantidad": cantidad,
                    "costo_unitario": Decimal("40000.00"),
                }
            ],
            usuario=self.admin,
        )
        return compra, compra.detalles.get()

    def _venta(
        self,
        cantidad,
        *,
        presentacion=None,
        precio="150000.00",
        estado_pago="pendiente",
        monto_inicial=None,
        fecha=None,
    ):
        return registrar_venta(
            cliente_id=self.cliente.id,
            fecha=fecha or date.today(),
            estado_pago=estado_pago,
            lineas=[
                {
                    "presentacion_id": (
                        presentacion or self.presentacion
                    ).id,
                    "cantidad": cantidad,
                    "precio_venta": Decimal(precio),
                }
            ],
            monto_inicial=monto_inicial,
            fecha_pago=(
                date.today() if monto_inicial is not None else None
            ),
            usuario=self.admin,
        )

    def test_venta_con_inventario_completo(self):
        self._stock(2)
        venta = self._venta(2)
        detalle = venta.detalles.get()

        self.assertEqual(detalle.cantidad_cubierta, 2)
        self.assertEqual(detalle.cantidad_pendiente, 0)
        self.assertEqual(
            detalle.costo_unitario,
            Decimal("40000.00"),
        )
        self.assertEqual(venta.estado_abastecimiento, "completo")
        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                40,
            )["disponibles"],
            0,
        )

    def test_venta_parcial_registra_faltante(self):
        self._stock(2)
        venta = self._venta(3)
        detalle = venta.detalles.get()

        self.assertEqual(venta.total, Decimal("450000.00"))
        self.assertEqual(detalle.cantidad_cubierta, 2)
        self.assertEqual(detalle.cantidad_pendiente, 1)
        self.assertEqual(
            detalle.costo_unitario,
            Decimal("40000.00"),
        )
        self.assertEqual(venta.estado_abastecimiento, "parcial")
        self.assertEqual(
            venta.unidades_pendientes_abastecimiento,
            1,
        )

    def test_venta_sin_existencias_queda_pendiente(self):
        venta = self._venta(2)
        detalle = venta.detalles.get()

        self.assertEqual(venta.total, Decimal("300000.00"))
        self.assertEqual(detalle.cantidad_cubierta, 0)
        self.assertEqual(detalle.cantidad_pendiente, 2)
        self.assertEqual(detalle.costo_unitario, Decimal("0.00"))
        self.assertEqual(venta.estado_abastecimiento, "pendiente")
        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                40,
            )["disponibles"],
            0,
        )

    def test_venta_no_usa_stock_de_otro_porcentaje(self):
        self._stock(1)
        venta = self._venta(
            1,
            presentacion=self.presentacion_70,
            precio="180000.00",
        )
        detalle = venta.detalles.get()

        self.assertEqual(detalle.cantidad_pendiente, 1)
        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                40,
            )["disponibles"],
            1,
        )
        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                70,
            )["disponibles"],
            0,
        )

    def test_recepcion_cubre_venta_pendiente(self):
        venta = self._venta(2)
        compra, detalle_compra = self._compra_pendiente(2)
        detalle = venta.detalles.get()

        self.assertEqual(detalle.cantidad_pendiente, 2)

        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-venta-pendiente",
        )

        venta.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(detalle.cantidad_pendiente, 0)
        self.assertEqual(detalle.cantidad_cubierta, 2)
        self.assertEqual(
            detalle.costo_unitario,
            Decimal("40000.00"),
        )
        self.assertEqual(venta.estado_abastecimiento, "completo")

    def test_recepcion_parcial_conserva_faltante(self):
        venta = self._venta(3)
        compra, detalle_compra = self._compra_pendiente(2)

        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-venta-parcial",
        )

        detalle = venta.detalles.get()

        self.assertEqual(detalle.cantidad_pendiente, 1)
        self.assertEqual(detalle.cantidad_cubierta, 2)
        self.assertEqual(venta.estado_abastecimiento, "parcial")

    def test_recepcion_respeta_venta_pendiente_mas_antigua(self):
        antigua = self._venta(
            1,
            fecha=date.today() - timedelta(days=1),
        )
        nueva = self._venta(1, fecha=date.today())
        compra, detalle_compra = self._compra_pendiente(1)

        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 1,
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-fifo-ventas",
        )

        antigua.refresh_from_db()
        nueva.refresh_from_db()

        self.assertEqual(
            antigua.detalles.get().cantidad_pendiente,
            0,
        )
        self.assertEqual(
            nueva.detalles.get().cantidad_pendiente,
            1,
        )

    def test_reintento_de_recepcion_no_duplica_cobertura(self):
        venta = self._venta(2)
        compra, detalle_compra = self._compra_pendiente(2)

        for _ in range(2):
            registrar_recepcion(
                compra_id=compra.id,
                fecha=date.today(),
                lineas=[
                    {
                        "detalle_compra_id": detalle_compra.id,
                        "cantidad": 2,
                    }
                ],
                usuario=self.admin,
                clave_idempotencia="recepcion-venta-idempotente",
            )

        detalle = venta.detalles.get()
        detalle_compra.refresh_from_db()

        self.assertEqual(detalle.cantidad_pendiente, 0)
        self.assertEqual(detalle.cantidad_cubierta, 2)
        self.assertEqual(detalle_compra.cantidad_recibida, 2)

    def test_venta_pendiente_conserva_pago_y_saldo(self):
        venta = self._venta(
            2,
            estado_pago="abonado",
            monto_inicial=Decimal("100000.00"),
        )
        detalle = venta.detalles.get()

        self.assertEqual(detalle.cantidad_pendiente, 2)
        self.assertEqual(venta.saldo, Decimal("200000.00"))
        self.assertEqual(venta.estado_pago, "abonado")
        self.assertEqual(venta.abonos.count(), 1)

        compra, detalle_compra = self._compra_pendiente(2)
        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-venta-pago",
        )

        venta.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(detalle.cantidad_pendiente, 0)
        self.assertEqual(venta.saldo, Decimal("200000.00"))
        self.assertEqual(venta.estado_pago, "abonado")
        self.assertEqual(venta.abonos.count(), 1)

    def test_ganancia_solo_cuenta_unidades_cubiertas(self):
        venta = self._venta(2, precio="100000.00")
        detalle = venta.detalles.get()

        self.assertEqual(venta.ganancia, Decimal("0.00"))

        compra, detalle_compra = self._compra_pendiente(2)
        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-venta-ganancia",
        )

        detalle.refresh_from_db()
        venta.refresh_from_db()

        self.assertEqual(
            detalle.cantidad_cubierta,
            2,
        )
        self.assertEqual(
            venta.ganancia,
            Decimal("120000.00"),
        )

    def test_serializer_expone_estado_de_abastecimiento(self):
        venta = self._venta(2)
        data = VentaSerializer(venta).data

        self.assertEqual(data["estado_abastecimiento"], "pendiente")
        self.assertEqual(
            data["unidades_pendientes_abastecimiento"],
            2,
        )
        self.assertEqual(
            data["detalles"][0]["cantidad_pendiente"],
            2,
        )
        self.assertEqual(
            data["detalles"][0]["cantidad_cubierta"],
            0,
        )

    def test_api_permite_venta_sin_stock_y_expone_pendiente(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            {
                "cliente_id": self.cliente.id,
                "fecha": date.today().isoformat(),
                "estado_pago": "pendiente",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 2,
                        "precio_venta": "150000.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(respuesta.status_code, 201)
        self.assertEqual(
            respuesta.data["estado_abastecimiento"],
            "pendiente",
        )
        self.assertEqual(
            respuesta.data["unidades_pendientes_abastecimiento"],
            2,
        )
        self.assertEqual(
            respuesta.data["detalles"][0]["cantidad_pendiente"],
            2,
        )
        self.assertEqual(
            respuesta.data["detalles"][0]["cantidad_cubierta"],
            0,
        )

    def test_api_lista_ventas_por_comprar_y_las_retira_al_cubrir(self):
        venta = self._venta(2)
        compra, detalle_compra = self._compra_pendiente(2)
        self.client.force_authenticate(user=self.admin)

        pendientes = self.client.get(
            "/api/v1/finanzas/ventas/",
            {"con_pendientes": "1"},
        )
        self.assertEqual(
            pendientes.status_code,
            status.HTTP_200_OK,
        )
        fila = next(
            item
            for item in pendientes.data
            if item["id"] == venta.id
        )
        self.assertEqual(fila["origen"], "manual")
        self.assertEqual(fila["estado_abastecimiento"], "pendiente")
        self.assertEqual(
            fila["unidades_pendientes_abastecimiento"],
            2,
        )
        self.assertEqual(
            fila["detalles"][0]["cantidad_pendiente"],
            2,
        )
        self.assertEqual(
            fila["detalles"][0]["producto_nombre"],
            self.producto.nombre,
        )
        self.assertEqual(
            fila["detalles"][0]["porcentaje"],
            40,
        )

        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 1,
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-api-parcial-venta",
        )

        parciales = self.client.get(
            "/api/v1/finanzas/ventas/",
            {"con_pendientes": "1"},
        )
        fila = next(
            item
            for item in parciales.data
            if item["id"] == venta.id
        )
        self.assertEqual(fila["estado_abastecimiento"], "parcial")
        self.assertEqual(
            fila["unidades_pendientes_abastecimiento"],
            1,
        )

        compra_2, detalle_compra_2 = self._compra_pendiente(1)
        registrar_recepcion(
            compra_id=compra_2.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra_2.id,
                    "cantidad": 1,
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-api-total-venta",
        )

        completas = self.client.get(
            "/api/v1/finanzas/ventas/",
            {"con_pendientes": "1"},
        )
        self.assertNotIn(
            venta.id,
            [item["id"] for item in completas.data],
        )

    def test_compra_no_recibida_no_cubre_venta(self):
        venta = self._venta(1)
        compra, _detalle_compra = self._compra_pendiente(1)
        detalle = venta.detalles.get()

        self.assertEqual(detalle.cantidad_pendiente, 1)
        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                40,
            )["disponibles"],
            0,
        )
        self.assertEqual(compra.detalles.get().cantidad_recibida, 0)
