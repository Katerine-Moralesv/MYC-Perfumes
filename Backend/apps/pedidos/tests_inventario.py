from datetime import date, timedelta
from decimal import Decimal
from io import StringIO

from django.core.management import call_command
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import Categoria, PresentacionProducto, Producto
from apps.core.exceptions import ReglaNegocioError
from apps.finanzas.models import (
    Abono,
    AsignacionCompraPedido,
    Compra,
    DetalleCompra,
    Proveedor,
    Venta,
)
from apps.finanzas.services.compras import (
    registrar_compra,
    registrar_recepcion,
)
from apps.finanzas.services.inventario import disponibilidad_producto
from apps.finanzas.services.reportes import (
    recaudacion_periodo,
    resumen_dashboard,
)
from apps.pedidos.models import Pedido
from apps.pedidos.services.cancelacion import cancelar_pedido
from apps.pedidos.services.captura import registrar_pedido
from apps.pedidos.services.cierre import actualizar_estado_pedido
from apps.pedidos.services.confirmacion import confirmar_pedido
from apps.usuarios.models import Usuario


class InventarioYEntregasTests(APITestCase):
    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_inventario",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(nombre="Inventario")
        cls.producto = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume inventario",
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
        cls.producto_b = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume inventario B",
            precio=Decimal("150000.00"),
            contenido_ml=100,
        )
        cls.presentacion_b_70 = PresentacionProducto.objects.create(
            producto=cls.producto_b,
            porcentaje=70,
            activo=True,
        )
        cls.proveedor = Proveedor.objects.create(
            nombre="Proveedor inventario",
        )

    def _pedido(self, cantidad=1, telefono=None):
        return registrar_pedido(
            telefono=telefono or f"300100{self._testMethodName[-4:]}",
            nombre_cliente="Clienta inventario",
            lineas=[
                {
                    "producto_id": self.producto.id,
                    "recarga_solicitada": False,
                    "cantidad": cantidad,
                }
            ],
        )

    def _confirmar(self, pedido, estado_pago="pendiente", **kwargs):
        return confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago=estado_pago,
            usuario=self.admin,
            **kwargs,
        )

    def _pedido_70(self, cantidad=1, telefono=None):
        pedido = registrar_pedido(
            telefono=telefono or f"300400{self._testMethodName[-4:]}",
            nombre_cliente="Clienta 70",
            lineas=[
                {
                    "producto_id": self.producto.id,
                    "recarga_solicitada": True,
                    "porcentaje": 70,
                    "cantidad": cantidad,
                }
            ],
        )
        detalle = pedido.detalles.get()

        return confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
            lineas_precio=[
                {
                    "detalle_id": detalle.id,
                    "precio_venta": Decimal("180000.00"),
                }
            ],
        )

    def _recibir_linea(self, presentacion_id, detalle_pedido, cantidad=1):
        compra = registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=[
                {
                    "presentacion_id": presentacion_id,
                    "cantidad": cantidad,
                    "costo_unitario": Decimal("40000.00"),
                }
            ],
            usuario=self.admin,
        )
        detalle_compra = compra.detalles.get()

        return registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": cantidad,
                    "asignaciones": [
                        {
                            "detalle_pedido_id": detalle_pedido.id,
                            "cantidad": cantidad,
                        }
                    ],
                }
            ],
            usuario=self.admin,
        )

    def _ingresar_stock(
        self,
        cantidad,
        costo="40000.00",
        clave=None,
        presentacion_id=None,
    ):
        return registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=[
                {
                    "presentacion_id": (
                        presentacion_id or self.presentacion.id
                    ),
                    "cantidad": cantidad,
                    "cantidad_recibida": cantidad,
                    "costo_unitario": Decimal(costo),
                }
            ],
            usuario=self.admin,
            clave_idempotencia=(
                clave or f"stock-{cantidad}-{costo}-{presentacion_id}"
            ),
        )

    def _compra_pendiente(
        self,
        cantidad,
        costo="40000.00",
        clave=None,
        presentacion_id=None,
    ):
        compra = registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=[
                {
                    "presentacion_id": (
                        presentacion_id or self.presentacion.id
                    ),
                    "cantidad": cantidad,
                    "costo_unitario": Decimal(costo),
                }
            ],
            usuario=self.admin,
            clave_idempotencia=(
                clave
                or f"pendiente-{cantidad}-{costo}-{presentacion_id}"
            ),
        )
        return compra, compra.detalles.get()

    def _recibir_general(
        self,
        cantidad,
        presentacion_id=None,
        clave=None,
    ):
        compra, detalle_compra = self._compra_pendiente(
            cantidad,
            presentacion_id=presentacion_id,
            clave=clave,
        )
        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": cantidad,
                }
            ],
            usuario=self.admin,
            clave_idempotencia=f"{clave or 'recepcion-general'}-recibir",
        )
        return compra

    def test_pedido_cubierto_completamente_por_inventario(self):
        self._ingresar_stock(3, clave="stock-completo")
        pedido = self._pedido(cantidad=2)

        pedido = self._confirmar(pedido)

        pedido.refresh_from_db()
        detalle = pedido.detalles.get()
        stock = disponibilidad_producto(self.producto.id)

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(pedido.venta_id)
        self.assertEqual(pedido.venta.total, Decimal("300000.00"))
        self.assertEqual(detalle.cantidad_recibida, 2)
        self.assertEqual(
            detalle.costo_unitario_real,
            Decimal("40000.00"),
        )
        self.assertEqual(stock["disponibles"], 1)
        self.assertEqual(stock["reservadas"], 0)
        self.assertEqual(Venta.objects.count(), 1)

        repetido = self._confirmar(pedido)
        self.assertEqual(repetido.venta_id, pedido.venta_id)
        self.assertEqual(Venta.objects.count(), 1)

    def test_pedido_sin_existencias_queda_por_comprar(self):
        pedido = self._pedido(cantidad=2)

        pedido = self._confirmar(pedido)
        pedido.refresh_from_db()
        detalle = pedido.detalles.get()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(detalle.cantidad_recibida, 0)
        self.assertEqual(detalle.cantidad_pendiente, 2)
        self.assertEqual(
            disponibilidad_producto(self.producto.id)["disponibles"],
            0,
        )

    def test_pedido_parcial_y_recepcion_completa(self):
        self._ingresar_stock(1, clave="stock-parcial")
        pedido = self._pedido(cantidad=3)
        pedido = self._confirmar(pedido)
        pedido.refresh_from_db()
        detalle = pedido.detalles.get()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertEqual(detalle.cantidad_recibida, 1)
        self.assertEqual(detalle.cantidad_pendiente, 2)
        self.assertIsNone(pedido.venta_id)

        compra, detalle_compra = self._compra_pendiente(
            2,
            clave="compra-parcial",
        )
        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                    "asignaciones": [
                        {
                            "detalle_pedido_id": detalle.id,
                            "cantidad": 2,
                        }
                    ],
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-parcial",
        )

        pedido.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(pedido.venta_id)
        self.assertEqual(detalle.cantidad_recibida, 3)
        self.assertEqual(
            disponibilidad_producto(self.producto.id)["disponibles"],
            0,
        )

    def test_compra_inventario_general_sin_pedido_queda_libre(self):
        compra, detalle_compra = self._compra_pendiente(
            2,
            clave="compra-general",
        )

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
            clave_idempotencia="recepcion-general",
        )

        stock = disponibilidad_producto(self.producto.id)

        self.assertEqual(stock["disponibles"], 2)
        self.assertEqual(
            AsignacionCompraPedido.objects.filter(
                liberada_en__isnull=True
            ).count(),
            0,
        )
        self.assertEqual(Venta.objects.count(), 0)

    def test_dos_pedidos_compiten_por_la_misma_unidad(self):
        self._ingresar_stock(1, clave="stock-competencia")
        primero = self._confirmar(
            self._pedido(cantidad=1, telefono="3002000001")
        )
        segundo = self._confirmar(
            self._pedido(cantidad=1, telefono="3002000002")
        )
        primero.refresh_from_db()
        segundo.refresh_from_db()

        self.assertEqual(primero.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(primero.venta_id)
        self.assertEqual(segundo.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(segundo.venta_id)
        self.assertEqual(
            disponibilidad_producto(self.producto.id)["disponibles"],
            0,
        )

    def test_cancelar_libera_reservas_y_conserva_compra(self):
        compra = self._ingresar_stock(1, clave="stock-cancelacion")
        pedido = self._pedido(cantidad=2)
        pedido = self._confirmar(pedido)

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertEqual(
            disponibilidad_producto(self.producto.id)["disponibles"],
            0,
        )

        cancelado = cancelar_pedido(
            pedido_id=pedido.id,
            usuario=self.admin,
            motivo="Cancelación de prueba",
        )

        self.assertEqual(cancelado.estado, Pedido.Estado.CANCELADO)
        self.assertTrue(
            Compra.objects.filter(pk=compra.pk).exists()
        )
        self.assertEqual(
            disponibilidad_producto(self.producto.id)["disponibles"],
            1,
        )

    def test_anticipo_y_pago_completo_visibles_en_clientes(self):
        pedido = self._pedido(cantidad=2)
        self._confirmar(
            pedido,
            estado_pago="abonado",
            monto_recibido=Decimal("100000.00"),
        )
        pedido.refresh_from_db()

        self.client.force_authenticate(user=self.admin)
        resumen = self.client.get(
            "/api/v1/finanzas/clientes/resumen/"
        ).data
        cliente = next(
            item
            for item in resumen
            if item["id"] == pedido.cliente_id
        )

        self.assertEqual(cliente["ventas"], [])
        self.assertEqual(len(cliente["pedidos"]), 1)
        self.assertEqual(cliente["total_acordado"], "300000.00")
        self.assertEqual(cliente["total_pagado"], "100000.00")
        self.assertEqual(cliente["saldo_pendiente"], "200000.00")

        detalle = pedido.detalles.get()
        compra, detalle_compra = self._compra_pendiente(
            2,
            clave="compra-anticipo",
        )
        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                    "asignaciones": [
                        {
                            "detalle_pedido_id": detalle.id,
                            "cantidad": 2,
                        }
                    ],
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-anticipo",
        )

        resumen = self.client.get(
            "/api/v1/finanzas/clientes/resumen/"
        ).data
        cliente = next(
            item
            for item in resumen
            if item["id"] == pedido.cliente_id
        )

        self.assertEqual(len(cliente["ventas"]), 1)
        self.assertEqual(cliente["pedidos"], [])
        self.assertEqual(cliente["total_acordado"], "300000.00")
        self.assertEqual(cliente["total_pagado"], "100000.00")
        self.assertEqual(cliente["saldo_pendiente"], "200000.00")
        self.assertEqual(
            Abono.objects.filter(
                pedido=pedido,
                venta__isnull=True,
            ).count(),
            0,
        )

    def test_pago_completo_antes_de_comprar(self):
        pedido = self._pedido(cantidad=2)
        pedido = self._confirmar(
            pedido,
            estado_pago="pagado",
            monto_recibido=Decimal("300000.00"),
        )
        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(pedido.monto_pagado, Decimal("300000.00"))
        self.assertEqual(pedido.saldo_estimado, Decimal("0.00"))

        detalle = pedido.detalles.get()
        compra, detalle_compra = self._compra_pendiente(
            2,
            clave="compra-pagada",
        )
        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                    "asignaciones": [
                        {
                            "detalle_pedido_id": detalle.id,
                            "cantidad": 2,
                        }
                    ],
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-pagada",
        )

        pedido.refresh_from_db()

        self.assertEqual(pedido.venta.estado_pago, "pagado")
        self.assertEqual(pedido.venta.saldo, Decimal("0.00"))
        self.assertEqual(
            Abono.objects.filter(venta=pedido.venta).count(),
            1,
        )

    def test_reintentos_no_duplican_compra_recepcion_ni_venta(self):
        compra, detalle_compra = self._compra_pendiente(
            2,
            clave="retry-compra",
        )
        repetida = registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=[
                {
                    "presentacion_id": self.presentacion.id,
                    "cantidad": 2,
                    "costo_unitario": Decimal("40000.00"),
                }
            ],
            usuario=self.admin,
            clave_idempotencia="retry-compra",
        )
        self.assertEqual(compra.id, repetida.id)

        pedido = self._pedido(cantidad=2)
        pedido = self._confirmar(pedido)
        repetido = self._confirmar(pedido)
        self.assertEqual(repetido.id, pedido.id)
        self.assertEqual(Venta.objects.count(), 0)
        detalle = pedido.detalles.get()

        for _ in range(2):
            registrar_recepcion(
                compra_id=compra.id,
                fecha=date.today(),
                lineas=[
                    {
                        "detalle_compra_id": detalle_compra.id,
                        "cantidad": 2,
                        "asignaciones": [
                            {
                                "detalle_pedido_id": detalle.id,
                                "cantidad": 2,
                            }
                        ],
                    }
                ],
                usuario=self.admin,
                clave_idempotencia="retry-recepcion",
            )

        pedido.refresh_from_db()
        detalle_compra.refresh_from_db()

        self.assertEqual(detalle_compra.cantidad_recibida, 2)
        self.assertEqual(Compra.objects.count(), 1)
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(
            AsignacionCompraPedido.objects.count(),
            1,
        )

    def test_transiciones_invalidas_y_entrega_auditada(self):
        self._ingresar_stock(2, clave="stock-entrega")
        pedido = self._confirmar(self._pedido(cantidad=1))
        pedido.refresh_from_db()

        with self.assertRaises(ReglaNegocioError):
            actualizar_estado_pedido(
                pedido_id=pedido.id,
                nuevo_estado=Pedido.Estado.ENTREGADO,
                usuario=self.admin,
            )

        actualizar_estado_pedido(
            pedido_id=pedido.id,
            nuevo_estado=Pedido.Estado.PREPARANDO,
            usuario=self.admin,
        )
        actualizar_estado_pedido(
            pedido_id=pedido.id,
            nuevo_estado=Pedido.Estado.LISTO,
            usuario=self.admin,
        )
        entregado = actualizar_estado_pedido(
            pedido_id=pedido.id,
            nuevo_estado=Pedido.Estado.ENTREGADO,
            usuario=self.admin,
        )

        self.assertEqual(entregado.estado, Pedido.Estado.ENTREGADO)
        self.assertIsNotNone(entregado.entregado_en)
        self.assertEqual(entregado.entregado_por_id, self.admin.id)
        self.assertTrue(
            entregado.historial_estados.filter(
                estado_nuevo=Pedido.Estado.ENTREGADO
            ).exists()
        )
        self.assertEqual(Venta.objects.count(), 1)

        repetido = actualizar_estado_pedido(
            pedido_id=pedido.id,
            nuevo_estado=Pedido.Estado.ENTREGADO,
            usuario=self.admin,
        )
        self.assertEqual(
            repetido.entregado_en,
            entregado.entregado_en,
        )
        self.assertEqual(
            repetido.historial_estados.filter(
                estado_nuevo=Pedido.Estado.ENTREGADO
            ).count(),
            1,
        )

    def test_cliente_con_varios_pedidos_y_ventas(self):
        self._ingresar_stock(2, clave="stock-multiples")
        primero = self._confirmar(
            self._pedido(cantidad=1, telefono="3003000001")
        )
        segundo = self._confirmar(
            self._pedido(cantidad=1, telefono="3003000001")
        )
        self.client.force_authenticate(user=self.admin)

        resumen = self.client.get(
            "/api/v1/finanzas/clientes/resumen/"
        ).data
        cliente = next(
            item
            for item in resumen
            if item["id"] == primero.cliente_id
        )

        self.assertEqual(cliente["id"], segundo.cliente_id)
        self.assertEqual(len(cliente["ventas"]), 2)
        self.assertEqual(cliente["total_acordado"], "300000.00")
        self.assertEqual(cliente["saldo_pendiente"], "300000.00")

    def test_recaudacion_no_duplica_anticipos_ni_ventas(self):
        pedido = self._pedido(cantidad=2)
        self._confirmar(
            pedido,
            estado_pago="abonado",
            monto_recibido=Decimal("100000.00"),
        )
        detalle = pedido.detalles.get()
        compra, detalle_compra = self._compra_pendiente(
            2,
            clave="compra-recaudacion",
        )
        registrar_recepcion(
            compra_id=compra.id,
            fecha=date.today(),
            lineas=[
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                    "asignaciones": [
                        {
                            "detalle_pedido_id": detalle.id,
                            "cantidad": 2,
                        }
                    ],
                }
            ],
            usuario=self.admin,
            clave_idempotencia="recepcion-recaudacion",
        )

        recaudacion = recaudacion_periodo(
            date.today(),
            date.today() + timedelta(days=1),
        )
        dashboard = resumen_dashboard(
            date.today().strftime("%Y-%m")
        )

        self.assertTrue(recaudacion["disponible"])
        self.assertEqual(recaudacion["importe"], 100000.0)
        self.assertEqual(
            dashboard["metricas_actuales"]["saldo_por_cobrar"],
            200000.0,
        )

    def test_endpoints_de_compra_y_recepcion_son_idempotentes(self):
        self.client.force_authenticate(user=self.admin)
        payload = {
            "proveedor_id": self.proveedor.id,
            "fecha": date.today().isoformat(),
            "lineas": [
                {
                    "presentacion_id": self.presentacion.id,
                    "cantidad": 2,
                    "costo_unitario": "40000.00",
                }
            ],
        }

        for _ in range(2):
            respuesta = self.client.post(
                "/api/v1/finanzas/compras/registrar/",
                payload,
                format="json",
                HTTP_IDEMPOTENCY_KEY="compra-endpoint-0001",
            )
            self.assertEqual(
                respuesta.status_code,
                status.HTTP_201_CREATED,
            )

        compra = Compra.objects.get()
        detalle_compra = compra.detalles.get()
        self.assertEqual(Compra.objects.count(), 1)
        self.assertEqual(detalle_compra.cantidad_recibida, 0)

        recepcion_payload = {
            "fecha": date.today().isoformat(),
            "lineas": [
                {
                    "detalle_compra_id": detalle_compra.id,
                    "cantidad": 2,
                }
            ],
        }

        for _ in range(2):
            respuesta = self.client.post(
                f"/api/v1/finanzas/compras/{compra.id}/recibir/",
                recepcion_payload,
                format="json",
                HTTP_IDEMPOTENCY_KEY="recepcion-endpoint-0001",
            )
            self.assertEqual(
                respuesta.status_code,
                status.HTTP_201_CREATED,
            )

        detalle_compra.refresh_from_db()
        self.assertEqual(detalle_compra.cantidad_recibida, 2)
        self.assertEqual(
            disponibilidad_producto(self.producto.id)["disponibles"],
            2,
        )

    def test_asignacion_rechaza_mismo_producto_con_porcentaje_distinto(self):
        pedido = self._pedido_70()
        detalle = pedido.detalles.get()

        with self.assertRaises(ReglaNegocioError):
            self._recibir_linea(
                self.presentacion.id,
                detalle,
            )

        detalle.refresh_from_db()
        self.assertEqual(detalle.cantidad_recibida, 0)

    def test_asignacion_permite_mismo_producto_y_porcentaje(self):
        pedido = self._pedido_70()
        detalle = pedido.detalles.get()

        self._recibir_linea(
            self.presentacion_70.id,
            detalle,
        )

        pedido.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertEqual(detalle.cantidad_recibida, 1)
        self.assertIsNotNone(pedido.venta_id)

    def test_asignacion_rechaza_producto_diferente(self):
        pedido = self._pedido_70()
        detalle = pedido.detalles.get()

        with self.assertRaises(ReglaNegocioError):
            self._recibir_linea(
                self.presentacion_b_70.id,
                detalle,
            )

    def test_asignacion_rechaza_cantidad_superior_a_la_pendiente(self):
        pedido = self._pedido_70()
        detalle = pedido.detalles.get()

        with self.assertRaises(ReglaNegocioError):
            self._recibir_linea(
                self.presentacion_70.id,
                detalle,
                cantidad=2,
            )

    def test_inventario_de_otro_porcentaje_no_cubre_el_pedido(self):
        self._ingresar_stock(1, clave="stock-40-no-cubre-70")
        pedido = self._pedido_70()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(
            pedido.detalles.get().cantidad_recibida,
            0,
        )
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

    def test_api_rechaza_asignacion_con_porcentaje_incorrecto(self):
        pedido = self._pedido_70()
        detalle = pedido.detalles.get()
        self.client.force_authenticate(user=self.admin)
        compras_antes = Compra.objects.count()

        respuesta = self.client.post(
            "/api/v1/finanzas/compras/registrar/",
            {
                "proveedor_id": self.proveedor.id,
                "fecha": date.today().isoformat(),
                "lineas": [
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                        "cantidad_recibida": 1,
                        "costo_unitario": "40000.00",
                        "asignaciones": [
                            {
                                "detalle_pedido_id": detalle.id,
                                "cantidad": 1,
                            }
                        ],
                    }
                ],
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="compra-mismatch-0001",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Compra.objects.count(), compras_antes)
        detalle.refresh_from_db()
        self.assertEqual(detalle.cantidad_recibida, 0)

    def test_compra_multilinea_valida_cada_asignacion(self):
        pedido_a = self._pedido_70(telefono="3005000001")
        pedido_b = self._pedido_70(telefono="3005000002")
        detalle_a = pedido_a.detalles.get()
        detalle_b = pedido_b.detalles.get()
        compras_antes = Compra.objects.count()

        with self.assertRaises(ReglaNegocioError):
            registrar_compra(
                proveedor_id=self.proveedor.id,
                fecha=date.today(),
                lineas=[
                    {
                        "presentacion_id": self.presentacion_70.id,
                        "cantidad": 1,
                        "cantidad_recibida": 1,
                        "costo_unitario": Decimal("40000.00"),
                        "asignaciones": [
                            {
                                "detalle_pedido_id": detalle_a.id,
                                "cantidad": 1,
                            }
                        ],
                    },
                    {
                        "presentacion_id": self.presentacion_b_70.id,
                        "cantidad": 1,
                        "cantidad_recibida": 1,
                        "costo_unitario": Decimal("40000.00"),
                        "asignaciones": [
                            {
                                "detalle_pedido_id": detalle_b.id,
                                "cantidad": 1,
                            }
                        ],
                    },
                ],
                usuario=self.admin,
            )

        self.assertEqual(Compra.objects.count(), compras_antes)
        detalle_a.refresh_from_db()
        detalle_b.refresh_from_db()
        self.assertEqual(detalle_a.cantidad_recibida, 0)
        self.assertEqual(detalle_b.cantidad_recibida, 0)

    def test_recepcion_general_cubre_pedido_confirmado_sin_stock(self):
        pedido = self._confirmar(self._pedido(cantidad=1))
        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)

        self._recibir_general(2, clave="reconciliar-completo")

        pedido.refresh_from_db()
        detalle = pedido.detalles.get()

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(pedido.venta_id)
        self.assertEqual(detalle.cantidad_recibida, 1)
        self.assertEqual(detalle.cantidad_pendiente, 0)
        self.assertEqual(pedido.venta.detalles.get().cantidad, 1)
        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                40,
            )["disponibles"],
            1,
        )

    def test_recepcion_general_parcial_calcula_faltante(self):
        pedido = self._confirmar(self._pedido(cantidad=3))
        self._recibir_general(2, clave="reconciliar-parcial-1")

        pedido.refresh_from_db()
        detalle = pedido.detalles.get()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(detalle.cantidad_recibida, 2)
        self.assertEqual(detalle.cantidad_pendiente, 1)

        self._recibir_general(1, clave="reconciliar-parcial-2")

        pedido.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(pedido.venta_id)
        self.assertEqual(detalle.cantidad_pendiente, 0)

    def test_recepcion_general_otro_porcentaje_no_cubre(self):
        pedido = self._confirmar(self._pedido_70())

        self._recibir_general(
            1,
            presentacion_id=self.presentacion.id,
            clave="reconciliar-40-para-70",
        )

        pedido.refresh_from_db()
        detalle = pedido.detalles.get()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertEqual(detalle.cantidad_recibida, 0)
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

    def test_recepcion_general_respeta_pedido_mas_antiguo(self):
        antiguo = self._confirmar(
            self._pedido(cantidad=1, telefono="3006000001")
        )
        nuevo = self._confirmar(
            self._pedido(cantidad=1, telefono="3006000002")
        )

        self._recibir_general(1, clave="reconciliar-competencia")

        antiguo.refresh_from_db()
        nuevo.refresh_from_db()

        self.assertEqual(antiguo.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(antiguo.venta_id)
        self.assertEqual(nuevo.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(nuevo.venta_id)
        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                40,
            )["disponibles"],
            0,
        )

    def test_pedido_actualiza_tarjeta_y_detalle_tras_reconciliar(self):
        pedido = self._confirmar(self._pedido(cantidad=1))
        self._recibir_general(2, clave="reconciliar-api")
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.get("/api/v1/pedidos/")
        fila = next(
            item
            for item in respuesta.data
            if item["id"] == pedido.id
        )
        detalle = fila["detalles"][0]

        self.assertEqual(fila["estado"], Pedido.Estado.COMPRADO)
        self.assertEqual(fila["unidades_pendientes_compra"], 0)
        self.assertEqual(detalle["cantidad_pendiente"], 0)
        self.assertEqual(detalle["cantidad_cubierta"], 1)
        self.assertIsNotNone(fila["venta"])

    def test_cancelar_pedido_parcial_libera_stock_reconciliado(self):
        pedido = self._confirmar(self._pedido(cantidad=3))
        self._recibir_general(2, clave="reconciliar-cancelacion")
        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                40,
            )["disponibles"],
            0,
        )

        cancelar_pedido(
            pedido_id=pedido.id,
            usuario=self.admin,
            motivo="Cancelación posterior a reconciliación",
        )

        self.assertEqual(
            disponibilidad_producto(
                self.producto.id,
                40,
            )["disponibles"],
            2,
        )

    def test_comando_reconcilia_pedidos_historicos(self):
        pedido = self._confirmar(self._pedido(cantidad=1))
        compra = Compra.objects.create(
            proveedor=self.proveedor,
            fecha=date.today(),
            total=Decimal("40000.00"),
            registrado_por=self.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=self.presentacion,
            cantidad=1,
            cantidad_recibida=1,
            costo_unitario=Decimal("40000.00"),
        )
        salida = StringIO()

        call_command(
            "reconciliar_inventario",
            usuario=self.admin.username,
            pedido=pedido.id,
            stdout=salida,
        )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(pedido.venta_id)
        self.assertIn("Pedidos reconciliados: 1", salida.getvalue())

    def test_comando_idempotente_no_duplica_venta_pago_ni_reserva(self):
        pedido = self._pedido(cantidad=2)
        pedido = self._confirmar(
            pedido,
            estado_pago="abonado",
            monto_recibido=Decimal("100000.00"),
        )
        compra = Compra.objects.create(
            proveedor=self.proveedor,
            fecha=date.today(),
            total=Decimal("80000.00"),
            registrado_por=self.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=self.presentacion,
            cantidad=2,
            cantidad_recibida=2,
            costo_unitario=Decimal("40000.00"),
        )

        for _ in range(2):
            call_command(
                "reconciliar_inventario",
                usuario=self.admin.username,
                pedido=pedido.id,
                stdout=StringIO(),
            )

        pedido.refresh_from_db()
        venta = pedido.venta
        abono = Abono.objects.get(pedido=pedido)

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(Abono.objects.count(), 1)
        self.assertEqual(abono.venta_id, venta.id)
        self.assertEqual(abono.monto, Decimal("100000.00"))
        self.assertEqual(venta.total, Decimal("300000.00"))
        self.assertEqual(venta.saldo, Decimal("200000.00"))
        self.assertEqual(venta.estado_pago, "abonado")
        self.assertEqual(
            venta.detalles.get().precio_venta,
            Decimal("150000.00"),
        )
        self.assertEqual(
            venta.detalles.get().costo_unitario,
            Decimal("40000.00"),
        )
        asignaciones = AsignacionCompraPedido.objects.filter(
            detalle_pedido__pedido=pedido,
            liberada_en__isnull=True,
        )
        self.assertEqual(asignaciones.count(), 1)
        self.assertEqual(asignaciones.get().cantidad, 2)

    def test_comando_idempotente_en_pedido_parcial(self):
        pedido = self._confirmar(self._pedido(cantidad=3))
        compra = Compra.objects.create(
            proveedor=self.proveedor,
            fecha=date.today(),
            total=Decimal("80000.00"),
            registrado_por=self.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=self.presentacion,
            cantidad=2,
            cantidad_recibida=2,
            costo_unitario=Decimal("40000.00"),
        )

        for _ in range(2):
            call_command(
                "reconciliar_inventario",
                usuario=self.admin.username,
                pedido=pedido.id,
                stdout=StringIO(),
            )

        pedido.refresh_from_db()
        detalle = pedido.detalles.get()
        asignaciones = AsignacionCompraPedido.objects.filter(
            detalle_pedido=detalle,
            liberada_en__isnull=True,
        )

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(detalle.cantidad_recibida, 2)
        self.assertEqual(detalle.cantidad_pendiente, 1)
        self.assertEqual(asignaciones.count(), 1)
        self.assertEqual(asignaciones.get().cantidad, 2)

    def test_endpoint_estado_rechaza_salto_invalido(self):
        pedido = self._pedido(cantidad=1)
        self._confirmar(pedido)
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            f"/api/v1/pedidos/{pedido.id}/estado/",
            {"estado": "entregado"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
