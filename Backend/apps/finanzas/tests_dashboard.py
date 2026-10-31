import uuid
from datetime import date, timedelta
from decimal import Decimal

from django.db import connection
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import (
    Categoria,
    PresentacionProducto,
    Producto,
)
from apps.finanzas.models import (
    Abono,
    Cliente,
    Compra,
    DetalleCompra,
    Proveedor,
    Venta,
)
from apps.finanzas.services import reportes as servicios_reportes
from apps.finanzas.services.pagos import registrar_abono
from apps.finanzas.services.ventas import registrar_venta
from apps.pedidos.models import Pedido
from apps.usuarios.models import Usuario


class ReporteDashboardTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_dashboard",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cls.vendedor = Usuario.objects.create_user(
            username="vendedor_dashboard",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )

        categoria = Categoria.objects.create(
            nombre="CategorÃ­a dashboard"
        )
        cls.producto_a = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume A",
            precio=Decimal("150000.00"),
        )
        cls.producto_b = Producto.objects.create(
            categoria=categoria,
            nombre="Perfume B",
            precio=Decimal("100000.00"),
        )
        cls.presentacion_a = PresentacionProducto.objects.create(
            producto=cls.producto_a,
            porcentaje=60,
            es_personalizada=False,
        )
        cls.presentacion_b = PresentacionProducto.objects.create(
            producto=cls.producto_b,
            porcentaje=60,
            es_personalizada=False,
        )
        proveedor = Proveedor.objects.create(
            nombre="Proveedor dashboard"
        )
        compra = Compra.objects.create(
            proveedor=proveedor,
            fecha=date(2025, 1, 1),
            total=Decimal("90000.00"),
            registrado_por=cls.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=cls.presentacion_a,
            cantidad=10,
            cantidad_recibida=10,
            costo_unitario=Decimal("50000.00"),
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=cls.presentacion_b,
            cantidad=10,
            cantidad_recibida=10,
            costo_unitario=Decimal("40000.00"),
        )

        cls.cliente_1 = Cliente.objects.create(
            nombre="Clienta uno",
            telefono="3001000001",
        )
        cls.cliente_2 = Cliente.objects.create(
            nombre="Clienta dos",
            telefono="3001000002",
        )
        cls.cliente_3 = Cliente.objects.create(
            nombre="Clienta tres",
            telefono="3001000003",
        )

        cls.venta_a_pendiente = registrar_venta(
            cliente_id=cls.cliente_1.id,
            fecha=date(2026, 1, 5),
            estado_pago="pendiente",
            lineas=[
                {
                    "presentacion_id": cls.presentacion_a.id,
                    "cantidad": 2,
                    "precio_venta": Decimal("150000.00"),
                }
            ],
            usuario=cls.admin,
        )
        cls.venta_b_pagada = registrar_venta(
            cliente_id=cls.cliente_2.id,
            fecha=date(2026, 1, 10),
            estado_pago="pagado",
            fecha_pago=date(2026, 1, 20),
            lineas=[
                {
                    "presentacion_id": cls.presentacion_b.id,
                    "cantidad": 4,
                    "precio_venta": Decimal("100000.00"),
                }
            ],
            usuario=cls.admin,
        )
        cls.venta_a_abonada = registrar_venta(
            cliente_id=cls.cliente_3.id,
            fecha=date(2026, 1, 25),
            estado_pago="abonado",
            monto_inicial=Decimal("50000.00"),
            fecha_pago=date(2026, 1, 26),
            lineas=[
                {
                    "presentacion_id": cls.presentacion_a.id,
                    "cantidad": 1,
                    "precio_venta": Decimal("150000.00"),
                }
            ],
            usuario=cls.admin,
        )
        cls.venta_diciembre = registrar_venta(
            cliente_id=cls.cliente_1.id,
            fecha=date(2025, 12, 15),
            estado_pago="pendiente",
            lineas=[
                {
                    "presentacion_id": cls.presentacion_a.id,
                    "cantidad": 1,
                    "precio_venta": Decimal("150000.00"),
                }
            ],
            usuario=cls.admin,
        )
        registrar_abono(
            venta_id=cls.venta_a_pendiente.id,
            monto=Decimal("100000.00"),
            fecha=date(2026, 2, 10),
            usuario=cls.admin,
            clave_idempotencia=uuid.uuid4().hex,
        )

        cls.pedidos = []
        base = timezone.now()

        for indice in range(6):
            if indice < 3:
                estado = Pedido.Estado.PENDIENTE
            elif indice < 5:
                estado = Pedido.Estado.CONFIRMADO
            else:
                estado = Pedido.Estado.RECHAZADO

            pedido = Pedido.objects.create(
                cliente=cls.cliente_1,
                telefono_origen="3001000001",
                estado=estado,
                total=Decimal("10000.00"),
            )
            Pedido.objects.filter(pk=pedido.pk).update(
                creado_en=base - timedelta(days=indice)
            )
            cls.pedidos.append(pedido)

    def _get(self, mes):
        self.client.force_authenticate(user=self.admin)
        return self.client.get(
            f"/api/v1/finanzas/reportes/dashboard/?mes={mes}"
        )

    def test_metricas_del_periodo_y_series_mensuales(self):
        respuesta = self._get("2026-01")

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        data = respuesta.data

        self.assertEqual(
            data["periodo"]["mes"],
            "2026-01",
        )
        self.assertEqual(
            data["periodo"]["fecha_inicio"],
            "2026-01-01",
        )
        self.assertEqual(
            data["periodo"]["fecha_fin_exclusiva"],
            "2026-02-01",
        )
        self.assertEqual(
            data["metricas_periodo"]["ganancia_bruta"],
            540000.0,
        )
        self.assertEqual(
            data["metricas_periodo"]["total_vendido"],
            850000.0,
        )
        self.assertEqual(
            [
                item["mes"]
                for item in data["metricas_periodo"][
                    "ganancias_mensuales"
                ]
            ],
            [
                "2025-08",
                "2025-09",
                "2025-10",
                "2025-11",
                "2025-12",
                "2026-01",
            ],
        )
        self.assertEqual(
            [
                item["ganancia"]
                for item in data["metricas_periodo"][
                    "ganancias_mensuales"
                ]
            ],
            [0.0, 0.0, 0.0, 0.0, 100000.0, 540000.0],
        )

    def test_unidades_y_ganancias_por_producto_son_distintas(self):
        data = self._get("2026-01").data["metricas_periodo"]

        self.assertEqual(
            data["unidades_por_producto"],
            [
                {
                    "producto_id": self.producto_b.id,
                    "producto_nombre": "Perfume B",
                    "unidades": 4,
                },
                {
                    "producto_id": self.producto_a.id,
                    "producto_nombre": "Perfume A",
                    "unidades": 3,
                },
            ],
        )
        self.assertEqual(
            data["ganancia_por_producto"],
            [
                {
                    "producto_id": self.producto_a.id,
                    "producto_nombre": "Perfume A",
                    "ganancia": 300000.0,
                },
                {
                    "producto_id": self.producto_b.id,
                    "producto_nombre": "Perfume B",
                    "ganancia": 240000.0,
                },
            ],
        )

    def test_metricas_actuales_no_cambian_al_cambiar_de_mes(self):
        enero = self._get("2026-01").data
        diciembre = self._get("2025-12").data

        self.assertEqual(
            enero["metricas_actuales"],
            diciembre["metricas_actuales"],
        )
        self.assertEqual(
            enero["metricas_actuales"],
            {
                "saldo_por_cobrar": 470000.0,
                "clientes_con_deudas": 2,
                "clientes_registrados": 3,
                "pedidos_pendientes": 3,
                "pedidos_por_comprar": 2,
                "saldo_pedidos_por_comprar": 20000.0,
                "pedidos_confirmados_sin_venta": 2,

            },
        )
        self.assertEqual(
            diciembre["metricas_periodo"]["total_vendido"],
            150000.0,
        )
        self.assertEqual(
            diciembre["metricas_periodo"]["ganancia_bruta"],
            100000.0,
        )

    def test_recaudacion_usa_fecha_de_pago_y_no_fecha_de_venta(self):
        enero = self._get("2026-01").data
        febrero = self._get("2026-02").data

        self.assertEqual(
            enero["metricas_periodo"]["recaudacion"],
            {
                "disponible": True,
                "devoluciones": 0.0,
                "importe": 450000.0,
                "motivo": None,
            },
        )
        self.assertEqual(
            febrero["metricas_periodo"]["total_vendido"],
            0.0,
        )
        self.assertEqual(
            febrero["metricas_periodo"]["recaudacion"],
            {
                "disponible": True,
                "devoluciones": 0.0,
                "importe": 100000.0,
                "motivo": None,
            },
        )

    def test_recaudacion_no_disponible_por_venta_historica_sin_abono(
        self,
    ):
        Venta.objects.create(
            cliente=self.cliente_1,
            fecha=date(2024, 6, 1),
            estado_pago=Venta.EstadoPago.PAGADO,
            total=Decimal("100000.00"),
            saldo=Decimal("0.00"),
            registrado_por=self.admin,
        )

        respuesta = self._get("2026-01")
        recaudacion = respuesta.data["metricas_periodo"][
            "recaudacion"
        ]

        self.assertFalse(recaudacion["disponible"])
        self.assertIsNone(recaudacion["importe"])
        self.assertTrue(recaudacion["motivo"])

    def test_recaudacion_acepta_abonos_historicos_sin_tipo_ni_creado_en(
        self,
    ):
        venta = Venta.objects.create(
            cliente=self.cliente_1,
            fecha=date(2024, 6, 1),
            estado_pago=Venta.EstadoPago.PAGADO,
            total=Decimal("100000.00"),
            saldo=Decimal("0.00"),
            registrado_por=self.admin,
        )
        abono = Abono.objects.create(
            venta=venta,
            monto=Decimal("100000.00"),
            fecha=date(2024, 6, 10),
            registrado_por=self.admin,
        )
        Abono.objects.filter(pk=abono.pk).update(creado_en=None)

        data = self._get("2024-06").data["metricas_periodo"][
            "recaudacion"
        ]

        self.assertEqual(
            data,
            {
                "disponible": True,
                "devoluciones": 0.0,
                "importe": 100000.0,
                "motivo": None,
            },
        )

    def test_mes_sin_datos_devuelve_ceros_legitimos(self):
        data = self._get("2025-08").data["metricas_periodo"]

        self.assertEqual(data["ganancia_bruta"], 0.0)
        self.assertEqual(data["total_vendido"], 0.0)
        self.assertEqual(data["unidades_por_producto"], [])
        self.assertEqual(data["ganancia_por_producto"], [])
        self.assertEqual(
            data["recaudacion"],
            {
                "disponible": True,
                "devoluciones": 0.0,
                "importe": 0.0,
                "motivo": None,
            },
        )
        self.assertEqual(
            [item["ganancia"] for item in data["ganancias_mensuales"]],
            [0.0, 0.0, 0.0, 0.0, 0.0, 0.0],
        )

    def test_pedidos_recientes_y_metricas_actuales(self):
        data = self._get("2026-01").data

        self.assertEqual(len(data["pedidos_recientes"]), 5)
        self.assertEqual(
            [pedido["id"] for pedido in data["pedidos_recientes"]],
            [pedido.id for pedido in self.pedidos[:5]],
        )
        self.assertEqual(
            data["metricas_actuales"]["pedidos_pendientes"],
            3,
        )
        self.assertEqual(
            data["pedidos_recientes"][0]["cliente_nombre"],
            "Clienta uno",
        )
        self.assertEqual(
            data["pedidos_recientes"][0]["total"],
            10000.0,
        )

    def test_mes_invalido_es_rechazado(self):
        self.client.force_authenticate(user=self.admin)

        for mes in (
            "",
            "2026-13",
            "2026-1",
            "2026-00",
            "2026-01-01",
        ):
            with self.subTest(mes=mes):
                sufijo = f"?mes={mes}" if mes else ""
                respuesta = self.client.get(
                    f"/api/v1/finanzas/reportes/dashboard/{sufijo}"
                )
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )

    def test_permisos_del_reporte(self):
        self.client.force_authenticate(user=self.admin)
        self.assertEqual(
            self.client.get(
                "/api/v1/finanzas/reportes/dashboard/?mes=2026-01"
            ).status_code,
            status.HTTP_200_OK,
        )

        self.client.force_authenticate(user=self.vendedor)
        self.assertEqual(
            self.client.get(
                "/api/v1/finanzas/reportes/dashboard/?mes=2026-01"
            ).status_code,
            status.HTTP_403_FORBIDDEN,
        )

        self.client.force_authenticate(user=None)
        self.assertEqual(
            self.client.get(
                "/api/v1/finanzas/reportes/dashboard/?mes=2026-01"
            ).status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_consultas_no_crecen_con_mas_registros(self):
        self.client.force_authenticate(user=self.admin)

        with CaptureQueriesContext(connection) as consultas_uno:
            respuesta_uno = self.client.get(
                "/api/v1/finanzas/reportes/dashboard/?mes=2026-01"
            )

        self.assertEqual(
            respuesta_uno.status_code,
            status.HTTP_200_OK,
        )
        self.assertLess(len(consultas_uno), 30)

        for _ in range(5):
            registrar_venta(
                cliente_id=self.cliente_1.id,
                fecha=date(2026, 1, 30),
                estado_pago="pendiente",
                lineas=[
                    {
                        "presentacion_id": self.presentacion_a.id,
                        "cantidad": 1,
                        "precio_venta": Decimal("150000.00"),
                    }
                ],
                usuario=self.admin,
            )

        with CaptureQueriesContext(connection) as consultas_varios:
            respuesta_varios = self.client.get(
                "/api/v1/finanzas/reportes/dashboard/?mes=2026-01"
            )

        self.assertEqual(
            respuesta_varios.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            len(consultas_uno),
            len(consultas_varios),
        )

    def test_servicio_de_recaudacion_disponible(self):
        data = servicios_reportes.recaudacion_periodo(
            date(2026, 1, 1),
            date(2026, 2, 1),
        )

        self.assertEqual(
            data,
            {
                "disponible": True,
                "devoluciones": 0.0,
                "importe": 450000.0,
                "motivo": None,
            },
        )

