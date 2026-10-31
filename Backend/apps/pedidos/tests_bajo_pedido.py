from datetime import date, timedelta
from decimal import Decimal

from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import Categoria, PresentacionProducto, Producto
from apps.core.exceptions import ReglaNegocioError
from apps.finanzas.models import (
    Abono,
    AsignacionCompraPedido,
    Compra,
    DetalleCompra,
    Devolucion,
    Proveedor,
    Venta,
)
from apps.finanzas.services import reportes
from apps.finanzas.services.compras import registrar_compra
from apps.finanzas.services.pagos import registrar_abono
from apps.pedidos.models import Pedido
from apps.pedidos.services.anticipos import registrar_anticipo
from apps.pedidos.services.captura import registrar_pedido
from apps.pedidos.services.cancelacion import cancelar_pedido
from apps.pedidos.services.confirmacion import confirmar_pedido
from apps.usuarios.models import Usuario


class FlujoBajoPedidoTests(APITestCase):
    def setUp(self):
        self.admin = Usuario.objects.create_user(
            username="admin_bajo_pedido",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(nombre="Bajo pedido")
        self.producto = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume bajo pedido",
            precio=Decimal("100000.00"),
        )
        self.producto_b = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume bajo pedido B",
            precio=Decimal("120000.00"),
        )
        self.presentacion = PresentacionProducto.objects.create(
            producto=self.producto,
            porcentaje=40,
            es_personalizada=False,
        )
        self.presentacion_b = PresentacionProducto.objects.create(
            producto=self.producto_b,
            porcentaje=40,
            es_personalizada=False,
        )
        self.proveedor = Proveedor.objects.create(
            nombre="Proveedor bajo pedido",
        )

    def _pedido(self, cantidad=1, presentacion=None, telefono="3001110001"):
        return registrar_pedido(
            telefono=telefono,
            nombre_cliente="Clienta bajo pedido",
            lineas=[
                {
                    "presentacion_id": (
                        presentacion or self.presentacion
                    ).id,
                    "cantidad": cantidad,
                }
            ],
        )

    def _confirmar(self, pedido, **kwargs):
        return confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago=kwargs.pop("estado_pago", "pendiente"),
            usuario=self.admin,
            **kwargs,
        )

    def _compra(self, lineas):
        return registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=lineas,
            usuario=self.admin,
        )

    def _asignacion(self, detalle, cantidad=1):
        return {
            "detalle_pedido_id": detalle.id,
            "cantidad": cantidad,
        }

    def test_anticipo_idempotente_y_conciliacion_sin_duplicar_ingreso(self):
        pedido = self._pedido()
        self._confirmar(pedido)
        detalle = pedido.detalles.get()

        anticipo = registrar_anticipo(
            pedido_id=pedido.id,
            monto=Decimal("30000.00"),
            fecha=date.today(),
            usuario=self.admin,
            metodo_pago="efectivo",
            referencia="recibo-1",
            clave_idempotencia="anticipo-bajo-pedido-0001",
        )
        repetido = registrar_anticipo(
            pedido_id=pedido.id,
            monto=Decimal("30000.00"),
            fecha=date.today(),
            usuario=self.admin,
            metodo_pago="efectivo",
            referencia="recibo-1",
            clave_idempotencia="anticipo-bajo-pedido-0001",
        )

        self.assertEqual(anticipo.id, repetido.id)
        self.assertEqual(Abono.objects.count(), 1)
        self.assertIsNone(anticipo.venta_id)
        self.assertEqual(anticipo.pedido_id, pedido.id)
        self.assertEqual(anticipo.tipo, Abono.Tipo.ANTICIPO)

        self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 1,
                "costo_unitario": Decimal("40000.00"),
                "asignaciones": [self._asignacion(detalle)],
            }
        ])

        pedido.refresh_from_db()
        anticipo.refresh_from_db()

        self.assertIsNotNone(pedido.venta_id)
        self.assertEqual(anticipo.venta_id, pedido.venta_id)
        self.assertEqual(Abono.objects.count(), 1)
        self.assertEqual(pedido.venta.saldo, Decimal("70000.00"))
        self.assertEqual(pedido.venta.estado_pago, "abonado")

        registrar_abono(
            venta_id=pedido.venta_id,
            monto=Decimal("20000.00"),
            fecha=date.today(),
            usuario=self.admin,
            clave_idempotencia="abono-posterior-0001",
        )
        registrar_abono(
            venta_id=pedido.venta_id,
            monto=Decimal("20000.00"),
            fecha=date.today(),
            usuario=self.admin,
            clave_idempotencia="abono-posterior-0001",
        )

        pedido.venta.refresh_from_db()

        self.assertEqual(Abono.objects.count(), 2)
        self.assertEqual(pedido.venta.saldo, Decimal("50000.00"))
        self.assertEqual(pedido.venta.estado_pago, "abonado")

    def test_endpoint_anticipo_exige_y_respeta_idempotencia(self):
        pedido = self._pedido()
        self._confirmar(pedido)
        url = f"/api/v1/pedidos/{pedido.id}/anticipos/"
        self.client.force_authenticate(user=self.admin)

        sin_clave = self.client.post(
            url,
            {
                "monto": "25000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
        )
        self.assertEqual(
            sin_clave.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

        payload = {
            "monto": "25000.00",
            "fecha": date.today().isoformat(),
            "metodo_pago": "transferencia",
            "referencia": "TRX-001",
        }
        primera = self.client.post(
            url,
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="anticipo-api-0001",
        )
        segunda = self.client.post(
            url,
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY="anticipo-api-0001",
        )

        self.assertEqual(primera.status_code, status.HTTP_201_CREATED)
        self.assertEqual(segunda.status_code, status.HTTP_201_CREATED)
        self.assertEqual(
            primera.data["anticipo"]["id"],
            segunda.data["anticipo"]["id"],
        )
        self.assertEqual(Abono.objects.count(), 1)

        abono = Abono.objects.get()
        self.assertEqual(abono.pedido_id, pedido.id)
        self.assertIsNone(abono.venta_id)
        self.assertEqual(abono.metodo_pago, "transferencia")
        self.assertEqual(abono.referencia, "TRX-001")

    def test_recepcion_parcial_no_genera_venta_hasta_completar(self):
        pedido = self._pedido(cantidad=2)
        self._confirmar(pedido)
        detalle = pedido.detalles.get()

        self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 2,
                "cantidad_recibida": 1,
                "costo_unitario": Decimal("40000.00"),
                "asignaciones": [self._asignacion(detalle)],
            }
        ])

        pedido.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(detalle.cantidad_recibida, 1)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(
            DetalleCompra.objects.get().cantidad_pendiente,
            1,
        )

        self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 1,
                "costo_unitario": Decimal("60000.00"),
                "asignaciones": [self._asignacion(detalle)],
            }
        ])

        pedido.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertEqual(detalle.cantidad_recibida, 2)
        self.assertEqual(
            detalle.costo_unitario_real,
            Decimal("50000.00"),
        )
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(pedido.venta.total, Decimal("200000.00"))
        self.assertEqual(
            pedido.venta.detalles.get().costo_unitario,
            Decimal("50000.00"),
        )

    def test_una_compra_cubre_dos_pedidos_sin_duplicar_costo(self):
        pedido_a = self._pedido(telefono="3001110002")
        pedido_b = self._pedido(telefono="3001110003")
        self._confirmar(pedido_a)
        self._confirmar(pedido_b)
        detalle_a = pedido_a.detalles.get()
        detalle_b = pedido_b.detalles.get()

        compra = self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 2,
                "costo_unitario": Decimal("30000.00"),
                "asignaciones": [
                    self._asignacion(detalle_a),
                    self._asignacion(detalle_b),
                ],
            }
        ])

        pedido_a.refresh_from_db()
        pedido_b.refresh_from_db()

        self.assertEqual(Compra.objects.count(), 1)
        self.assertEqual(DetalleCompra.objects.count(), 1)
        self.assertEqual(compra.total, Decimal("60000.00"))
        self.assertEqual(
            AsignacionCompraPedido.objects.count(),
            2,
        )
        self.assertEqual(Venta.objects.count(), 2)
        self.assertIsNotNone(pedido_a.venta_id)
        self.assertIsNotNone(pedido_b.venta_id)
        self.assertEqual(
            pedido_a.venta.detalles.get().costo_unitario,
            Decimal("30000.00"),
        )
        self.assertEqual(
            pedido_b.venta.detalles.get().costo_unitario,
            Decimal("30000.00"),
        )
        self.assertEqual(
            pedido_a.venta.ganancia + pedido_b.venta.ganancia,
            Decimal("140000.00"),
        )

    def test_compra_recibida_sin_asignacion_no_genera_venta(self):
        pedido = self._pedido()
        self._confirmar(pedido)
        detalle = pedido.detalles.get()

        self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 1,
                "costo_unitario": Decimal("40000.00"),
            }
        ])

        pedido.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(detalle.cantidad_recibida, 0)
        self.assertIsNone(detalle.costo_unitario_real)
        self.assertEqual(Venta.objects.count(), 0)

    def test_costo_real_no_toma_la_compra_mas_reciente_global(self):
        self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 1,
                "costo_unitario": Decimal("1000.00"),
            }
        ])
        pedido = self._pedido()
        self._confirmar(pedido)
        detalle = pedido.detalles.get()

        self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 1,
                "costo_unitario": Decimal("90000.00"),
                "asignaciones": [self._asignacion(detalle)],
            }
        ])

        pedido.refresh_from_db()

        self.assertEqual(
            pedido.venta.detalles.get().costo_unitario,
            Decimal("90000.00"),
        )

    def test_cancelar_sin_anticipo_no_crea_registros_financieros(self):
        pedido = self._pedido()
        self._confirmar(pedido)

        cancelado = cancelar_pedido(
            pedido_id=pedido.id,
            usuario=self.admin,
            motivo="La clienta desistió",
        )
        repetido = cancelar_pedido(
            pedido_id=pedido.id,
            usuario=self.admin,
            motivo="La clienta desistió",
        )

        self.assertEqual(cancelado.estado, Pedido.Estado.CANCELADO)
        self.assertEqual(repetido.estado, Pedido.Estado.CANCELADO)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)
        self.assertEqual(Devolucion.objects.count(), 0)

    def test_cancelar_con_anticipo_crea_devolucion_sin_borrar_abono(self):
        pedido = self._pedido()
        self._confirmar(pedido)
        anticipo = registrar_anticipo(
            pedido_id=pedido.id,
            monto=Decimal("30000.00"),
            fecha=date.today(),
            usuario=self.admin,
            clave_idempotencia="anticipo-cancelacion-0001",
        )

        cancelar_pedido(
            pedido_id=pedido.id,
            usuario=self.admin,
            motivo="Cancelación con anticipo",
        )

        pedido.refresh_from_db()
        anticipo.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.CANCELADO)
        self.assertTrue(Abono.objects.filter(pk=anticipo.pk).exists())
        self.assertIsNone(pedido.venta_id)
        devolucion = Devolucion.objects.get()
        self.assertEqual(devolucion.pedido_id, pedido.id)
        self.assertEqual(devolucion.abono_id, anticipo.id)
        self.assertEqual(devolucion.monto, Decimal("30000.00"))

    def test_cancelar_tras_venta_registra_devolucion_y_consistencia_reportes(self):
        pedido = self._pedido()
        self._confirmar(pedido)
        detalle = pedido.detalles.get()
        registrar_anticipo(
            pedido_id=pedido.id,
            monto=Decimal("30000.00"),
            fecha=date.today(),
            usuario=self.admin,
            clave_idempotencia="anticipo-postventa-0001",
        )
        self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 1,
                "costo_unitario": Decimal("40000.00"),
                "asignaciones": [self._asignacion(detalle)],
            }
        ])

        pedido.refresh_from_db()
        venta_id = pedido.venta_id
        self.assertIsNotNone(venta_id)
        self.assertEqual(pedido.venta.saldo, Decimal("70000.00"))

        cancelar_pedido(
            pedido_id=pedido.id,
            usuario=self.admin,
            motivo="Devolución posterior a la venta",
            monto_devolucion=Decimal("30000.00"),
            metodo_pago="transferencia",
            referencia="DEV-001",
        )

        pedido.refresh_from_db()
        devolucion = Devolucion.objects.get()

        self.assertEqual(pedido.estado, Pedido.Estado.CANCELADO)
        self.assertTrue(Venta.objects.filter(pk=venta_id).exists())
        self.assertIsNotNone(pedido.venta_id)
        self.assertEqual(devolucion.venta_id, venta_id)
        self.assertEqual(devolucion.monto, Decimal("30000.00"))
        self.assertEqual(
            list(reportes.clientes_con_saldo()),
            [],
        )
        recaudacion = reportes.recaudacion_periodo(
            date.today(),
            date.today() + timedelta(days=1),
        )
        self.assertTrue(recaudacion["disponible"])
        self.assertEqual(recaudacion["importe"], 0.0)
        self.assertEqual(recaudacion["devoluciones"], 30000.0)

    def test_endpoint_venta_y_estados_son_idempotentes(self):
        pedido = self._pedido()
        self._confirmar(pedido)
        detalle = pedido.detalles.get()
        self._compra([
            {
                "presentacion_id": self.presentacion.id,
                "cantidad": 1,
                "costo_unitario": Decimal("40000.00"),
                "asignaciones": [self._asignacion(detalle)],
            }
        ])
        pedido.refresh_from_db()
        venta_id = pedido.venta_id
        self.client.force_authenticate(user=self.admin)

        for _ in range(2):
            respuesta = self.client.post(
                f"/api/v1/pedidos/{pedido.id}/venta/",
                {},
                format="json",
            )
            self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
            self.assertEqual(respuesta.data["venta"], venta_id)

        for estado in ("preparando", "listo", "entregado"):
            respuesta = self.client.post(
                f"/api/v1/pedidos/{pedido.id}/estado/",
                {"estado": estado},
                format="json",
            )
            self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
            self.assertEqual(respuesta.data["estado"], estado)

        self.assertEqual(Venta.objects.count(), 1)

    def test_varias_lineas_perfumes_y_cantidades_con_precios_distintos(self):
        pedido = registrar_pedido(
            telefono="3001110010",
            nombre_cliente="Clienta precios distintos",
            lineas=[
                {
                    "producto_id": self.producto.id,
                    "recarga_solicitada": True,
                    "porcentaje": 70,
                    "cantidad": 2,
                },
                {
                    "producto_id": self.producto_b.id,
                    "recarga_solicitada": True,
                    "porcentaje": 80,
                    "cantidad": 3,
                },
            ],
        )

        primera, segunda = list(pedido.detalles.order_by("id"))

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
            lineas_precio=[
                {
                    "detalle_id": primera.id,
                    "precio_venta": Decimal("125000.00"),
                },
                {
                    "detalle_id": segunda.id,
                    "precio_venta": Decimal("90000.00"),
                },
            ],
        )

        primera.refresh_from_db()
        segunda.refresh_from_db()
        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(pedido.total, Decimal("520000.00"))
        self.assertEqual(primera.precio_unitario, Decimal("125000.00"))
        self.assertEqual(segunda.precio_unitario, Decimal("90000.00"))
        self.assertEqual(primera.cantidad, 2)
        self.assertEqual(segunda.cantidad, 3)
        self.assertEqual(Venta.objects.count(), 0)

    def test_precio_invalido_y_cambio_posterior_no_modifican_pedido(self):
        pedido = registrar_pedido(
            telefono="3001110011",
            nombre_cliente="Clienta precio inválido",
            lineas=[
                {
                    "producto_id": self.producto.id,
                    "recarga_solicitada": True,
                    "porcentaje": 70,
                    "cantidad": 1,
                }
            ],
        )
        detalle = pedido.detalles.get()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="pendiente",
                usuario=self.admin,
                lineas_precio=[
                    {
                        "detalle_id": detalle.id,
                        "precio_venta": Decimal("0.00"),
                    }
                ],
            )

        pedido.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(detalle.precio_unitario, Decimal("0.00"))

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
            lineas_precio=[
                {
                    "detalle_id": detalle.id,
                    "precio_venta": Decimal("125000.00"),
                }
            ],
        )
        detalle.refresh_from_db()

        self.assertEqual(pedido.total, Decimal("125000.00"))
        self.assertEqual(detalle.precio_unitario, Decimal("125000.00"))
        self.assertIsNone(pedido.venta_id)
        self.assertEqual(Venta.objects.count(), 0)

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
            lineas_precio=[
                {
                    "detalle_id": detalle.id,
                    "precio_venta": Decimal("999999.00"),
                }
            ],
        )
        detalle.refresh_from_db()

        self.assertEqual(pedido.total, Decimal("125000.00"))
        self.assertEqual(detalle.precio_unitario, Decimal("125000.00"))
        self.assertEqual(Venta.objects.count(), 0)



