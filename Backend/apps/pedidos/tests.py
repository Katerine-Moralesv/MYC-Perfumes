import json
import threading
import unittest
import urllib.error
import urllib.request
from datetime import date, timedelta
from decimal import Decimal

from django.core.cache import cache
from django.db import connection
from django.test import (
    LiveServerTestCase,
    TransactionTestCase,
    override_settings,
)
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import Categoria, PresentacionProducto, Producto
from apps.core.exceptions import ReglaNegocioError
from apps.finanzas.models import (
    Abono,
    Compra,
    DetalleCompra,
    Devolucion,
    Proveedor,
    Venta,
)
from apps.finanzas.services.compras import registrar_compra
from apps.pedidos.models import Pedido
from apps.pedidos.services.captura import registrar_pedido
from apps.pedidos.services.cancelacion import cancelar_pedido
from apps.pedidos.services.cierre import completar_venta_pedido
from apps.pedidos.services.confirmacion import (
    confirmar_pedido,
    rechazar_pedido,
)
from apps.usuarios.models import Usuario


class PedidoFlowTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_test",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cls.vendedor = Usuario.objects.create_user(
            username="vendedor_test",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )
        cls.superusuario = Usuario.objects.create_superuser(
            username="super_test",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )

        categoria = Categoria.objects.create(nombre="Perfumes")

        cls.producto_a = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume A",
            precio=Decimal("150000.00"),
        )
        cls.producto_b = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume B",
            precio=Decimal("120000.00"),
        )

        cls.presentacion_normal = PresentacionProducto.objects.create(
            producto=cls.producto_a,
            porcentaje=40,
            es_personalizada=False,
        )
        cls.presentacion_personalizada = PresentacionProducto.objects.create(
            producto=cls.producto_a,
            porcentaje=70,
            es_personalizada=True,
        )
        cls.presentacion_60 = PresentacionProducto.objects.create(
            producto=cls.producto_a,
            porcentaje=60,
            es_personalizada=True,
        )
        cls.presentacion_80 = PresentacionProducto.objects.create(
            producto=cls.producto_a,
            porcentaje=80,
            es_personalizada=True,
        )
        cls.presentacion_b = PresentacionProducto.objects.create(
            producto=cls.producto_b,
            porcentaje=40,
            es_personalizada=False,
        )
        cls.presentacion_b_personalizada = (
            PresentacionProducto.objects.create(
                producto=cls.producto_b,
                porcentaje=70,
                es_personalizada=True,
            )
        )

        cls.proveedor = Proveedor.objects.create(
            nombre="Proveedor Test"
        )
        compra = Compra.objects.create(
            proveedor=cls.proveedor,
            fecha=date.today(),
            total=Decimal("150000.00"),
            registrado_por=cls.admin,
        )

        for presentacion in (
            cls.presentacion_normal,
            cls.presentacion_personalizada,
            cls.presentacion_60,
            cls.presentacion_80,
            cls.presentacion_b,
            cls.presentacion_b_personalizada,
        ):
            DetalleCompra.objects.create(
                compra=compra,
                presentacion=presentacion,
                cantidad=10,
                cantidad_recibida=0,
                costo_unitario=Decimal("50000.00"),
            )

    def _crear_pedido(self, lineas, telefono="3001234567"):
        return registrar_pedido(
            telefono=telefono,
            nombre_cliente="Clienta Test",
            lineas=lineas,
        )

    def _pedido_normal(self):
        return self._crear_pedido([
            {
                "presentacion_id": self.presentacion_normal.id,
                "cantidad": 1,
            }
        ])

    def _pedido_personalizado(self):
        return self._crear_pedido([
            {
                "presentacion_id": self.presentacion_personalizada.id,
                "cantidad": 1,
            }
        ])

    def _pedido_mixto(self):
        return self._crear_pedido([
            {
                "presentacion_id": self.presentacion_normal.id,
                "cantidad": 1,
            },
            {
                "presentacion_id": self.presentacion_b.id,
                "cantidad": 1,
            },
            {
                "presentacion_id": self.presentacion_personalizada.id,
                "cantidad": 1,
            },
        ])

    def _comprar_y_cerrar(
        self,
        pedido,
        costo_unitario=Decimal("50000.00"),
    ):
        lineas = []

        for detalle in (
            pedido.detalles
            .select_related("presentacion", "producto")
            .all()
        ):
            presentacion = detalle.presentacion

            if presentacion is None:
                presentacion = (
                    PresentacionProducto.objects
                    .filter(
                        producto=detalle.producto,
                        porcentaje=detalle.porcentaje_recarga,
                    )
                    .first()
                )

            if presentacion is None:
                presentacion = PresentacionProducto.objects.create(
                    producto=detalle.producto,
                    porcentaje=detalle.porcentaje_recarga,
                    es_personalizada=detalle.porcentaje_recarga != 40,
                )

            lineas.append({
                "presentacion_id": presentacion.id,
                "cantidad": detalle.cantidad,
                "costo_unitario": costo_unitario,
                "asignaciones": [
                    {
                        "detalle_pedido_id": detalle.id,
                        "cantidad": detalle.cantidad,
                    }
                ],
            })

        return registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=lineas,
            usuario=self.admin,
        )

    def test_pedido_normal_guarda_precio_catalogo(self):
        pedido = self._pedido_normal()

        detalle = pedido.detalles.get()

        self.assertEqual(
            detalle.precio_unitario,
            Decimal("150000.00"),
        )
        self.assertFalse(detalle.precio_pendiente)
        self.assertFalse(detalle.recarga_solicitada)
        self.assertEqual(detalle.porcentaje_recarga, 40)
        self.assertEqual(pedido.total, Decimal("150000.00"))
        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)

    def test_pedido_personalizado_inicia_en_cero_y_pendiente(self):
        pedido = self._pedido_personalizado()

        detalle = pedido.detalles.get()

        self.assertTrue(detalle.recarga_solicitada)
        self.assertEqual(detalle.porcentaje_recarga, 70)
        self.assertTrue(detalle.precio_pendiente)
        self.assertEqual(detalle.precio_unitario, Decimal("0.00"))
        self.assertEqual(pedido.total, Decimal("0.00"))
        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertEqual(Venta.objects.count(), 0)

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_producto_sin_recarga_asigna_40(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3006000001",
                "lineas": [
                    {
                        "producto_id": self.producto_a.id,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        self.assertEqual(respuesta.data["total"], "150000.00")
        detalle = respuesta.data["detalles"][0]
        self.assertEqual(detalle["porcentaje_recarga"], 40)
        self.assertFalse(detalle["recarga_solicitada"])
        self.assertFalse(detalle["precio_pendiente"])
        self.assertEqual(detalle["precio_unitario"], "150000.00")

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_producto_con_recarga_60_70_80(self):
        for indice, porcentaje in enumerate((60, 70, 80), start=2):
            with self.subTest(porcentaje=porcentaje):
                respuesta = self.client.post(
                    "/api/v1/pedidos/webhook/",
                    {
                        "telefono": f"300600000{indice}",
                        "lineas": [
                            {
                                "producto_id": self.producto_a.id,
                                "recarga_solicitada": True,
                                "porcentaje": porcentaje,
                                "cantidad": 1,
                            }
                        ],
                    },
                    format="json",
                    HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
                )

                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_201_CREATED,
                )
                detalle = respuesta.data["detalles"][0]
                self.assertEqual(
                    detalle["porcentaje_recarga"],
                    porcentaje,
                )
                self.assertTrue(detalle["recarga_solicitada"])
                self.assertTrue(detalle["precio_pendiente"])
                self.assertEqual(detalle["precio_unitario"], "0.00")

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_producto_sin_recarga_no_crea_presentacion(self):
        producto = Producto.objects.create(
            categoria=self.producto_a.categoria,
            nombre="Perfume sin configuración",
            precio=Decimal("170000.00"),
        )

        self.assertFalse(
            PresentacionProducto.objects.filter(
                producto=producto,
                porcentaje=40,
            ).exists()
        )

        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3006000005",
                "lineas": [
                    {
                        "producto_id": producto.id,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        detalle = respuesta.data["detalles"][0]
        self.assertEqual(detalle["producto"], producto.id)
        self.assertEqual(detalle["porcentaje_recarga"], 40)
        self.assertNotIn("presentacion", detalle)
        self.assertFalse(
            PresentacionProducto.objects.filter(
                producto=producto,
                porcentaje=40,
            ).exists()
        )

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_legacy_presentacion_40_y_70(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3006000006",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion_normal.id,
                        "cantidad": 1,
                    },
                    {
                        "presentacion_id": self.presentacion_personalizada.id,
                        "cantidad": 1,
                    },
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        self.assertEqual(respuesta.data["total"], "150000.00")

        detalles = {
            detalle["porcentaje_recarga"]: detalle
            for detalle in respuesta.data["detalles"]
        }

        self.assertFalse(detalles[40]["recarga_solicitada"])
        self.assertTrue(detalles[70]["recarga_solicitada"])
        self.assertTrue(detalles[70]["precio_pendiente"])
        self.assertEqual(
            detalles[40]["presentacion"],
            self.presentacion_normal.id,
        )
        self.assertEqual(
            detalles[70]["presentacion"],
            self.presentacion_personalizada.id,
        )

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_recarga_sin_presentacion_es_aceptada(self):
        producto = Producto.objects.create(
            categoria=self.producto_a.categoria,
            nombre="Perfume sin configuración 60",
            precio=Decimal("160000.00"),
        )

        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3006000011",
                "lineas": [
                    {
                        "producto_id": producto.id,
                        "recarga_solicitada": True,
                        "porcentaje": 60,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        detalle = respuesta.data["detalles"][0]
        self.assertEqual(detalle["producto"], producto.id)
        self.assertEqual(detalle["porcentaje_recarga"], 60)
        self.assertTrue(detalle["recarga_solicitada"])
        self.assertTrue(detalle["precio_pendiente"])
        self.assertNotIn("presentacion", detalle)
        self.assertFalse(
            PresentacionProducto.objects.filter(
                producto=producto,
                porcentaje=60,
            ).exists()
        )

    def test_confirmacion_sin_compra_previa_y_venta_al_asignar_costo(self):
        producto = Producto.objects.create(
            categoria=self.producto_a.categoria,
            nombre="Perfume con recarga sin costo configurado",
            precio=Decimal("160000.00"),
        )

        pedido = self._crear_pedido([
            {
                "producto_id": producto.id,
                "recarga_solicitada": True,
                "porcentaje": 70,
                "cantidad": 1,
            }
        ])
        detalle = pedido.detalles.get()

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
            lineas_precio=[
                {
                    "detalle_id": detalle.id,
                    "precio_venta": Decimal("120000.00"),
                }
            ],
        )

        detalle.refresh_from_db()
        pedido.refresh_from_db()

        self.assertEqual(detalle.precio_unitario, Decimal("120000.00"))
        self.assertFalse(detalle.precio_pendiente)
        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

        presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=70,
            es_personalizada=True,
        )

        registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=[
                {
                    "presentacion_id": presentacion.id,
                    "cantidad": 1,
                    "costo_unitario": Decimal("50000.00"),
                    "asignaciones": [
                        {
                            "detalle_pedido_id": detalle.id,
                            "cantidad": 1,
                        }
                    ],
                }
            ],
            usuario=self.admin,
        )

        pedido.refresh_from_db()
        detalle.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(pedido.venta)
        self.assertEqual(pedido.total, Decimal("120000.00"))
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(Abono.objects.count(), 0)
        self.assertEqual(detalle.cantidad_recibida, 1)
        self.assertEqual(
            detalle.costo_unitario_real,
            Decimal("50000.00"),
        )
        self.assertEqual(
            pedido.venta.detalles.get().precio_venta,
            Decimal("120000.00"),
        )
        self.assertEqual(
            pedido.venta.detalles.get().costo_unitario,
            Decimal("50000.00"),
        )

    def test_pedido_conserva_porcentaje_y_decision_al_consultar(self):
        pedido = self._crear_pedido([
            {
                "producto_id": self.producto_a.id,
                "recarga_solicitada": True,
                "porcentaje": 70,
                "cantidad": 1,
            }
        ])

        self.client.force_authenticate(user=self.admin)
        respuesta = self.client.get("/api/v1/pedidos/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        fila = next(
            item
            for item in respuesta.data
            if item["id"] == pedido.id
        )

        self.assertEqual(
            fila["detalles"][0]["porcentaje_recarga"],
            70,
        )
        self.assertTrue(
            fila["detalles"][0]["recarga_solicitada"]
        )

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_rechaza_producto_inexistente(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3006000012",
                "lineas": [
                    {
                        "producto_id": 999999,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_rechaza_producto_inactivo(self):
        producto = Producto.objects.create(
            categoria=self.producto_a.categoria,
            nombre="Perfume inactivo",
            precio=Decimal("160000.00"),
            activo=False,
        )

        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3006000013",
                "lineas": [
                    {
                        "producto_id": producto.id,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_rechaza_cantidad_invalida(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3006000014",
                "lineas": [
                    {
                        "producto_id": self.producto_a.id,
                        "recarga_solicitada": False,
                        "cantidad": 0,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_rechaza_porcentajes_invalidos(self):
        casos = [
            {
                "producto_id": self.producto_a.id,
                "recarga_solicitada": True,
                "porcentaje": 55,
                "cantidad": 1,
            },
            {
                "producto_id": self.producto_a.id,
                "recarga_solicitada": True,
                "porcentaje": 40,
                "cantidad": 1,
            },
            {
                "producto_id": self.producto_a.id,
                "recarga_solicitada": False,
                "porcentaje": 60,
                "cantidad": 1,
            },
            {
                "producto_id": self.producto_a.id,
                "cantidad": 1,
            },
        ]

        for indice, linea in enumerate(casos, start=7):
            with self.subTest(linea=linea):
                respuesta = self.client.post(
                    "/api/v1/pedidos/webhook/",
                    {
                        "telefono": f"300600000{indice}",
                        "lineas": [linea],
                    },
                    format="json",
                    HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
                )

                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )

    def test_pedido_mixto_calcula_total_provisional(self):
        pedido = self._pedido_mixto()

        self.assertEqual(pedido.total, Decimal("270000.00"))

        pendientes = pedido.detalles.filter(
            precio_pendiente=True
        )

        self.assertEqual(pendientes.count(), 1)
        self.assertEqual(
            pendientes.get().precio_unitario,
            Decimal("0.00"),
        )

    def test_multiples_personalizadas_precios_independientes(self):
        pedido = self._crear_pedido([
            {
                "presentacion_id": self.presentacion_personalizada.id,
                "cantidad": 1,
            },
            {
                "presentacion_id": self.presentacion_b_personalizada.id,
                "cantidad": 2,
            },
        ])

        self.assertEqual(pedido.total, Decimal("0.00"))

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
            lineas_precio=[
                {
                    "presentacion_id": self.presentacion_personalizada.id,
                    "precio_venta": Decimal("100000.00"),
                },
                {
                    "presentacion_id": (
                        self.presentacion_b_personalizada.id
                    ),
                    "precio_venta": Decimal("50000.00"),
                },
            ],
        )

        self.assertEqual(pedido.total, Decimal("200000.00"))
        self.assertIsNone(pedido.venta)

        self._comprar_y_cerrar(pedido)
        pedido.refresh_from_db()

        self.assertEqual(
            pedido.venta.total,
            Decimal("200000.00"),
        )

        precios = {
            detalle.presentacion_id: detalle.precio_unitario
            for detalle in pedido.detalles.all()
        }

        self.assertEqual(
            precios[self.presentacion_personalizada.id],
            Decimal("100000.00"),
        )
        self.assertEqual(
            precios[self.presentacion_b_personalizada.id],
            Decimal("50000.00"),
        )

    def test_no_confirma_personalizado_sin_precio_final(self):
        pedido = self._pedido_personalizado()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="pendiente",
                usuario=self.admin,
            )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)

    def test_confirma_mixto_y_recalcula_total(self):
        pedido = self._pedido_mixto()

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
            lineas_precio=[
                {
                    "presentacion_id": self.presentacion_personalizada.id,
                    "precio_venta": Decimal("180000.00"),
                }
            ],
        )

        self._comprar_y_cerrar(pedido)
        pedido.refresh_from_db()

        self.assertEqual(pedido.total, Decimal("450000.00"))
        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertIsNotNone(pedido.venta)
        self.assertEqual(pedido.venta.total, Decimal("450000.00"))

        normal = pedido.detalles.get(
            presentacion=self.presentacion_normal
        )
        personalizada = pedido.detalles.get(
            presentacion=self.presentacion_personalizada
        )

        self.assertEqual(
            normal.precio_unitario,
            Decimal("150000.00"),
        )
        self.assertEqual(
            personalizada.precio_unitario,
            Decimal("180000.00"),
        )
        self.assertFalse(personalizada.precio_pendiente)

        self.producto_a.refresh_from_db()
        self.assertEqual(
            self.producto_a.precio,
            Decimal("150000.00"),
        )

    def test_no_sobrescribe_precio_normal_en_confirmacion(self):
        pedido = self._pedido_normal()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="pendiente",
                usuario=self.admin,
                lineas_precio=[
                    {
                        "presentacion_id": self.presentacion_normal.id,
                        "precio_venta": Decimal("99000.00"),
                    }
                ],
            )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertEqual(Venta.objects.count(), 0)

    def test_precio_catalogo_posterior_no_altera_pedido(self):
        pedido = self._pedido_normal()

        self.producto_a.precio = Decimal("999999.00")
        self.producto_a.save(update_fields=["precio"])

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
        )

        self._comprar_y_cerrar(pedido)
        pedido.refresh_from_db()

        detalle = pedido.detalles.get()
        self.assertEqual(
            detalle.precio_unitario,
            Decimal("150000.00"),
        )
        self.assertEqual(
            pedido.venta.detalles.get().precio_venta,
            Decimal("150000.00"),
        )

    def test_confirmacion_sin_pago_no_crea_abono(self):
        pedido = self._pedido_normal()

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
        )

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Abono.objects.count(), 0)

        self._comprar_y_cerrar(pedido)
        pedido.refresh_from_db()

        self.assertEqual(pedido.venta.estado_pago, "pendiente")
        self.assertEqual(
            pedido.venta.saldo,
            Decimal("150000.00"),
        )
        self.assertEqual(
            Abono.objects.filter(venta=pedido.venta).count(),
            0,
        )

    def test_confirmacion_con_abono_parcial(self):
        pedido = self._pedido_normal()

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="abonado",
            usuario=self.admin,
            monto_recibido=Decimal("50000.00"),
        )

        anticipos = Abono.objects.filter(pedido=pedido, venta__isnull=True)

        self.assertEqual(anticipos.count(), 1)
        self.assertEqual(
            anticipos.get().monto,
            Decimal("50000.00"),
        )
        self.assertEqual(
            anticipos.get().tipo,
            Abono.Tipo.ANTICIPO,
        )
        self.assertIsNone(pedido.venta)

        self._comprar_y_cerrar(pedido)
        pedido.refresh_from_db()

        abonos = Abono.objects.filter(venta=pedido.venta)

        self.assertEqual(abonos.count(), 1)
        self.assertEqual(
            abonos.get().monto,
            Decimal("50000.00"),
        )
        self.assertEqual(
            pedido.venta.saldo,
            Decimal("100000.00"),
        )
        self.assertEqual(pedido.venta.estado_pago, "abonado")

    def test_confirmacion_con_pago_total(self):
        pedido = self._pedido_normal()

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pagado",
            usuario=self.admin,
            monto_recibido=Decimal("150000.00"),
        )

        anticipos = Abono.objects.filter(pedido=pedido, venta__isnull=True)

        self.assertEqual(anticipos.count(), 1)
        self.assertEqual(
            anticipos.get().monto,
            Decimal("150000.00"),
        )
        self.assertEqual(
            anticipos.get().tipo,
            Abono.Tipo.ANTICIPO,
        )
        self.assertIsNone(pedido.venta)

        self._comprar_y_cerrar(pedido)
        pedido.refresh_from_db()

        abonos = Abono.objects.filter(venta=pedido.venta)

        self.assertEqual(abonos.count(), 1)
        self.assertEqual(
            abonos.get().monto,
            Decimal("150000.00"),
        )
        self.assertEqual(pedido.venta.saldo, Decimal("0.00"))
        self.assertEqual(pedido.venta.estado_pago, "pagado")

    def test_pago_total_sin_monto_infiere_total(self):
        pedido = self._pedido_normal()

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pagado",
            usuario=self.admin,
        )

        anticipos = Abono.objects.filter(pedido=pedido, venta__isnull=True)

        self.assertEqual(anticipos.count(), 1)
        self.assertEqual(
            anticipos.get().monto,
            Decimal("150000.00"),
        )
        self.assertEqual(
            anticipos.get().tipo,
            Abono.Tipo.ANTICIPO,
        )

        self._comprar_y_cerrar(pedido)
        pedido.refresh_from_db()

        self.assertEqual(pedido.venta.saldo, Decimal("0.00"))
        self.assertEqual(pedido.venta.estado_pago, "pagado")

    def test_pago_total_con_monto_cero_es_rechazado(self):
        pedido = self._pedido_normal()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="pagado",
                usuario=self.admin,
                monto_recibido=Decimal("0.00"),
            )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

    def test_pendiente_con_monto_positivo_es_rechazado(self):
        pedido = self._pedido_normal()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="pendiente",
                usuario=self.admin,
                monto_recibido=Decimal("50000.00"),
            )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

    def test_abonado_sin_monto_es_rechazado(self):
        pedido = self._pedido_normal()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="abonado",
                usuario=self.admin,
            )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

    def test_abonado_igual_al_total_es_rechazado(self):
        pedido = self._pedido_normal()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="abonado",
                usuario=self.admin,
                monto_recibido=Decimal("150000.00"),
            )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

    def test_pagado_con_monto_parcial_es_rechazado(self):
        pedido = self._pedido_normal()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="pagado",
                usuario=self.admin,
                monto_recibido=Decimal("50000.00"),
            )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

    def test_falta_costo_conserva_precio_y_no_crea_venta_ni_abono(self):
        producto = Producto.objects.create(
            categoria=self.producto_a.categoria,
            nombre="Perfume sin costo",
            precio=Decimal("160000.00"),
        )
        presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=80,
            es_personalizada=True,
        )

        pedido = self._crear_pedido(
            [
                {
                    "presentacion_id": presentacion.id,
                    "cantidad": 1,
                }
            ],
            telefono="3009998877",
        )

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=self.admin,
            lineas_precio=[
                {
                    "presentacion_id": presentacion.id,
                    "precio_venta": Decimal("180000.00"),
                }
            ],
        )

        pedido.refresh_from_db()
        detalle = pedido.detalles.get()

        self.assertEqual(pedido.estado, Pedido.Estado.POR_COMPRAR)
        self.assertIsNone(pedido.venta)
        self.assertEqual(pedido.total, Decimal("180000.00"))
        self.assertEqual(
            detalle.precio_unitario,
            Decimal("180000.00"),
        )
        self.assertFalse(detalle.precio_pendiente)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

        registrar_compra(
            proveedor_id=self.proveedor.id,
            fecha=date.today(),
            lineas=[
                {
                    "presentacion_id": presentacion.id,
                    "cantidad": 1,
                    "costo_unitario": Decimal("50000.00"),
                    "asignaciones": [
                        {
                            "detalle_pedido_id": detalle.id,
                            "cantidad": 1,
                        }
                    ],
                }
            ],
            usuario=self.admin,
        )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.COMPRADO)
        self.assertEqual(pedido.total, Decimal("180000.00"))
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(Abono.objects.count(), 0)
        self.assertEqual(
            pedido.venta.detalles.get().precio_venta,
            Decimal("180000.00"),
        )
        self.assertEqual(
            pedido.venta.detalles.get().costo_unitario,
            Decimal("50000.00"),
        )

    def test_abono_no_puede_superar_total(self):
        pedido = self._pedido_normal()

        with self.assertRaises(ReglaNegocioError):
            confirmar_pedido(
                pedido_id=pedido.id,
                estado_pago="abonado",
                usuario=self.admin,
                monto_recibido=Decimal("200000.00"),
            )

        pedido.refresh_from_db()

        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertEqual(Venta.objects.count(), 0)

    def test_confirmacion_guarda_fecha_de_pago_y_registro_real(self):
        pedido = self._pedido_normal()
        fecha_pago = date.today() - timedelta(days=2)

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pagado",
            usuario=self.admin,
            fecha_pago=fecha_pago,
        )

        abono = Abono.objects.get(venta=pedido.venta)
        self.assertEqual(abono.fecha, fecha_pago)
        self.assertIsNotNone(abono.creado_en)
        self.assertNotEqual(
            abono.creado_en.date(),
            fecha_pago,
        )

    def test_confirmacion_repetida_no_duplica_venta_ni_abono(self):
        pedido = self._pedido_normal()

        confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="abonado",
            usuario=self.admin,
            monto_recibido=Decimal("50000.00"),
        )

        confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="abonado",
            usuario=self.admin,
            monto_recibido=Decimal("50000.00"),
        )

        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 1)

        self._comprar_y_cerrar(pedido)
        pedido.refresh_from_db()

        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(Abono.objects.count(), 1)
        self.assertEqual(pedido.venta.saldo, Decimal("100000.00"))

    def test_rechazo_no_genera_venta(self):
        pedido = self._pedido_normal()

        pedido = rechazar_pedido(
            pedido_id=pedido.id,
            usuario=self.admin,
            motivo="No disponible",
        )

        self.assertEqual(pedido.estado, Pedido.Estado.RECHAZADO)
        self.assertIsNone(pedido.venta)
        self.assertEqual(Venta.objects.count(), 0)

    def test_solo_admin_puede_confirmar(self):
        pedido = self._pedido_normal()
        url = f"/api/v1/pedidos/{pedido.id}/confirmar/"

        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.post(
            url,
            {"estado_pago": "pendiente"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )

        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            url,
            {"estado_pago": "pendiente"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(respuesta.data["total"], "150000.00")
        self.assertEqual(respuesta.data["estado_pago"], "pendiente")
        self.assertEqual(respuesta.data["saldo"], "150000.00")
        self.assertEqual(respuesta.data["monto_pagado"], "0.00")
        self.assertTrue(respuesta.data["precios_completos"])

    def test_superusuario_con_rol_vendedor_puede_confirmar(self):
        pedido = self._pedido_normal()

        self.client.force_authenticate(user=self.superusuario)

        respuesta = self.client.post(
            f"/api/v1/pedidos/{pedido.id}/confirmar/",
            {"estado_pago": "pendiente"},
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data["estado"], "por_comprar")

    def test_vendedor_no_puede_listar_pedidos(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.get("/api/v1/pedidos/")

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_visitante_no_puede_listar_pedidos(self):
        respuesta = self.client.get("/api/v1/pedidos/")

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_admin_puede_listar_pedidos(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.get("/api/v1/pedidos/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

    def test_api_confirmar_personalizado_con_abono(self):
        pedido = self._pedido_personalizado()
        url = f"/api/v1/pedidos/{pedido.id}/confirmar/"

        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            url,
            {
                "estado_pago": "abonado",
                "monto_recibido": "50000.00",
                "lineas_precio": [
                    {
                        "presentacion_id": (
                            self.presentacion_personalizada.id
                        ),
                        "precio_venta": "180000.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(respuesta.data["total"], "180000.00")
        self.assertEqual(respuesta.data["estado_pago"], "abonado")
        self.assertEqual(respuesta.data["saldo"], "130000.00")
        self.assertEqual(respuesta.data["monto_pagado"], "50000.00")
        self.assertTrue(respuesta.data["precios_completos"])
        self.assertFalse(
            respuesta.data["detalles"][0]["precio_pendiente"]
        )
        self.assertEqual(
            respuesta.data["detalles"][0]["precio_unitario"],
            "180000.00",
        )

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_sin_token_es_rechazado(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3005550001",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion_normal.id,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Pedido.objects.count(), 0)

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_token_invalido_es_rechazado(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3005550002",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion_normal.id,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-incorrecto",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Pedido.objects.count(), 0)

    @override_settings(WEBHOOK_TOKEN="")
    def test_webhook_no_configurado_es_rechazado(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3005550003",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion_normal.id,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="cualquier-token",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_503_SERVICE_UNAVAILABLE,
        )
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Pedido.objects.count(), 0)

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_ignora_authorization_invalido(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3005550004",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion_normal.id,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
            HTTP_AUTHORIZATION="Bearer token-invalido",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )

    @override_settings(WEBHOOK_TOKEN="token-de-prueba")
    def test_webhook_normal_guarda_precio_y_no_genera_venta(self):
        respuesta = self.client.post(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3005557788",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion_normal.id,
                        "cantidad": 1,
                    }
                ],
            },
            format="json",
            HTTP_X_WEBHOOK_TOKEN="token-de-prueba",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(respuesta.data["total"], "150000.00")
        self.assertFalse(
            respuesta.data["detalles"][0]["precio_pendiente"]
        )
        self.assertEqual(Venta.objects.count(), 0)


class ConfirmacionConcurrenteTests(TransactionTestCase):
    @unittest.skipUnless(
        connection.vendor == "postgresql",
        "La prueba de concurrencia requiere PostgreSQL.",
    )
    def test_dos_confirmaciones_simultaneas_crean_una_sola_venta(self):
        admin = Usuario.objects.create_user(
            username="admin_concurrente",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(
            nombre="Perfumes concurrentes"
        )
        producto = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume concurrente",
            precio=Decimal("100000.00"),
        )
        presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=40,
            es_personalizada=False,
        )
        proveedor = Proveedor.objects.create(
            nombre="Proveedor concurrente"
        )
        compra = Compra.objects.create(
            proveedor=proveedor,
            fecha=date.today(),
            total=Decimal("50000.00"),
            registrado_por=admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=presentacion,
            cantidad=1,
            cantidad_recibida=1,
            costo_unitario=Decimal("50000.00"),
        )

        pedido = registrar_pedido(
            telefono="3010000000",
            nombre_cliente="Clienta concurrente",
            lineas=[
                {
                    "presentacion_id": presentacion.id,
                    "cantidad": 1,
                }
            ],
        )

        pedido = confirmar_pedido(
            pedido_id=pedido.id,
            estado_pago="pendiente",
            usuario=admin,
        )

        detalle = pedido.detalles.get()
        detalle.cantidad_recibida = detalle.cantidad
        detalle.costo_unitario_real = Decimal("50000.00")
        detalle.save(
            update_fields=[
                "cantidad_recibida",
                "costo_unitario_real",
            ]
        )

        barera = threading.Barrier(2)
        resultados = []

        def intentar_cerrar():
            try:
                barera.wait(timeout=10)
                completar_venta_pedido(
                    pedido_id=pedido.id,
                    usuario=admin,
                )
                resultados.append("ok")
            except Exception as exc:
                resultados.append(type(exc).__name__)
            finally:
                connection.close()

        hilos = [
            threading.Thread(target=intentar_cerrar)
            for _ in range(2)
        ]

        for hilo in hilos:
            hilo.start()

        for hilo in hilos:
            hilo.join(timeout=15)

        self.assertFalse(
            any(hilo.is_alive() for hilo in hilos),
            "Los hilos de cierre no terminaron.",
        )
        self.assertEqual(resultados.count("ok"), 2)
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(Abono.objects.count(), 0)


@override_settings(
    WEBHOOK_TOKEN="token-http",
    ALLOWED_HOSTS=["*"],
)
class HttpRealTests(LiveServerTestCase):
    def setUp(self):
        cache.clear()

        self.admin = Usuario.objects.create_user(
            username="admin_http",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        self.vendedor = Usuario.objects.create_user(
            username="vendedor_http",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )
        categoria = Categoria.objects.create(nombre="Perfumes HTTP")
        producto = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume HTTP",
            precio=Decimal("150000.00"),
        )
        self.presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=40,
            es_personalizada=False,
        )
        proveedor = Proveedor.objects.create(nombre="Proveedor HTTP")
        compra = Compra.objects.create(
            proveedor=proveedor,
            fecha=date.today(),
            total=Decimal("50000.00"),
            registrado_por=self.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=self.presentacion,
            cantidad=1,
            cantidad_recibida=0,
            costo_unitario=Decimal("50000.00"),
        )
        self.opener = urllib.request.build_opener(
            urllib.request.ProxyHandler({})
        )

    def _post_json(self, path, payload, headers=None):
        request = urllib.request.Request(
            self.live_server_url + path,
            data=json.dumps(payload).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                **(headers or {}),
            },
            method="POST",
        )

        try:
            with self.opener.open(request, timeout=10) as response:
                body = response.read().decode("utf-8")
                return response.status, json.loads(body or "{}")
        except urllib.error.HTTPError as exc:
            body = exc.read().decode("utf-8")
            return exc.code, json.loads(body or "{}")

    def _login(self, username):
        return self._post_json(
            "/api/v1/auth/login/",
            {
                "username": username,
                "password": "clave-segura-123",
            },
        )

    def test_flujo_http_real_login_webhook_confirmacion_y_permisos(self):
        estado, pedido = self._post_json(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3007770001",
                "nombre_cliente": "Clienta HTTP",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                    }
                ],
            },
            {"X-Webhook-Token": "token-http"},
        )

        self.assertEqual(estado, 201)
        self.assertEqual(pedido["total"], "150000.00")
        self.assertEqual(
            pedido["detalles"][0]["precio_unitario"],
            "150000.00",
        )
        self.assertFalse(pedido["detalles"][0]["precio_pendiente"])

        estado, _ = self._post_json(
            "/api/v1/pedidos/webhook/",
            {
                "telefono": "3007770002",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                    }
                ],
            },
        )
        self.assertEqual(estado, 401)

        estado, login_admin = self._login("admin_http")
        self.assertEqual(estado, 200)
        token_admin = login_admin["access"]

        estado, confirmado = self._post_json(
            f"/api/v1/pedidos/{pedido['id']}/confirmar/",
            {"estado_pago": "pendiente"},
            {"Authorization": f"Bearer {token_admin}"},
        )
        self.assertEqual(estado, 200)
        self.assertEqual(confirmado["estado"], "por_comprar")
        self.assertEqual(confirmado["estado_pago"], "pendiente")
        self.assertEqual(confirmado["saldo"], "150000.00")
        self.assertIsNone(confirmado["venta"])

        estado, repetido = self._post_json(
            f"/api/v1/pedidos/{pedido['id']}/confirmar/",
            {"estado_pago": "pendiente"},
            {"Authorization": f"Bearer {token_admin}"},
        )
        self.assertEqual(estado, 200)
        self.assertEqual(repetido["estado"], "por_comprar")
        self.assertIsNone(repetido["venta"])

        estado, compra = self._post_json(
            "/api/v1/finanzas/compras/registrar/",
            {
                "proveedor_id": Proveedor.objects.get(
                    nombre="Proveedor HTTP"
                ).id,
                "fecha": date.today().isoformat(),
                "lineas": [
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                        "costo_unitario": "50000.00",
                        "asignaciones": [
                            {
                                "detalle_pedido_id": confirmado[
                                    "detalles"
                                ][0]["id"],
                                "cantidad": 1,
                            }
                        ],
                    }
                ],
            },
            {
                "Authorization": f"Bearer {token_admin}",
                "Idempotency-Key": "compra-http-0001",
            },
        )
        self.assertEqual(estado, 201)
        self.assertEqual(len(compra["detalles"]), 1)

        pedido_cerrado = Pedido.objects.get(pk=pedido["id"])
        self.assertIsNotNone(pedido_cerrado.venta_id)
        self.assertEqual(pedido_cerrado.estado, Pedido.Estado.COMPRADO)

        estado, _ = self._post_json(
            f"/api/v1/pedidos/{pedido['id']}/confirmar/",
            {"estado_pago": "pendiente"},
        )
        self.assertEqual(estado, 401)

        estado, login_vendedor = self._login("vendedor_http")
        self.assertEqual(estado, 200)
        token_vendedor = login_vendedor["access"]

        estado, _ = self._post_json(
            f"/api/v1/pedidos/{pedido['id']}/confirmar/",
            {"estado_pago": "pendiente"},
            {"Authorization": f"Bearer {token_vendedor}"},
        )
        self.assertEqual(estado, 403)
