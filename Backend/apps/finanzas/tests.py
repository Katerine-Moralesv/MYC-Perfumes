import threading
import unittest
import uuid
from datetime import date, datetime, time, timedelta
from decimal import Decimal
from unittest.mock import patch
from zoneinfo import ZoneInfo

from django.db import IntegrityError, connection
from django.test import (
    SimpleTestCase,
    TransactionTestCase,
    override_settings,
)
from django.test.utils import CaptureQueriesContext
from django.utils import timezone
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import (
    Categoria,
    PresentacionProducto,
    Producto,
)
from apps.core.exceptions import ReglaNegocioError
from apps.finanzas.models import (
    Abono,
    Cliente,
    Compra,
    DetalleCompra,
    Proveedor,
    Venta,
)
from apps.finanzas.repositories import costo_unitario_vigente
from apps.finanzas.services.pagos import (
    normalizar_fecha_pago,
    registrar_abono,
)
from apps.finanzas.services.ventas import registrar_venta
from apps.usuarios.models import Usuario


class FinanzasPermisosTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_finanzas",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cls.vendedor = Usuario.objects.create_user(
            username="vendedor_finanzas",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )

        categoria = Categoria.objects.create(nombre="Categoría finanzas")
        producto = Producto.objects.create(
            categoria=categoria,
            nombre="Producto finanzas",
            precio=Decimal("150000.00"),
        )
        cls.presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=60,
            es_personalizada=False,
        )
        cls.cliente = Cliente.objects.create(
            nombre="Clienta finanzas",
            telefono="3001230000",
        )

        proveedor = Proveedor.objects.create(
            nombre="Proveedor finanzas"
        )
        compra = Compra.objects.create(
            proveedor=proveedor,
            fecha=date.today(),
            total=Decimal("50000.00"),
            registrado_por=cls.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=cls.presentacion,
            cantidad=10,
            cantidad_recibida=10,
            costo_unitario=Decimal("50000.00"),
        )

        lineas = [
            {
                "presentacion_id": cls.presentacion.id,
                "cantidad": 1,
                "precio_venta": Decimal("150000.00"),
            }
        ]

        cls.venta_vendedor = registrar_venta(
            cliente_id=cls.cliente.id,
            fecha=date.today(),
            estado_pago="pendiente",
            lineas=lineas,
            usuario=cls.vendedor,
        )
        cls.venta_admin = registrar_venta(
            cliente_id=cls.cliente.id,
            fecha=date.today(),
            estado_pago="pendiente",
            lineas=lineas,
            usuario=cls.admin,
        )

    def test_vendedor_solo_ve_sus_propias_ventas(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.get("/api/v1/finanzas/ventas/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(len(respuesta.data), 1)
        self.assertEqual(
            respuesta.data[0]["id"],
            self.venta_vendedor.id,
        )

    def test_admin_ve_todas_las_ventas(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.get("/api/v1/finanzas/ventas/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(len(respuesta.data), 2)

    def test_vendedor_no_ve_detalle_de_venta_ajena(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.get(
            f"/api/v1/finanzas/ventas/{self.venta_admin.id}/"
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_vendedor_ve_detalle_de_su_venta(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.get(
            f"/api/v1/finanzas/ventas/{self.venta_vendedor.id}/"
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

    def test_admin_ve_detalle_de_cualquier_venta(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.get(
            f"/api/v1/finanzas/ventas/{self.venta_vendedor.id}/"
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

    def test_vendedor_puede_abonar_su_propia_venta(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.post(
            f"/api/v1/finanzas/ventas/{self.venta_vendedor.id}/abonos/",
            {
                "monto": "50000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data["saldo"], "100000.00")
        self.assertEqual(respuesta.data["estado_pago"], "abonado")

    def test_vendedor_no_puede_abonar_venta_ajena(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.post(
            f"/api/v1/finanzas/ventas/{self.venta_admin.id}/abonos/",
            {
                "monto": "50000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.venta_admin.refresh_from_db()
        self.assertEqual(
            self.venta_admin.saldo,
            Decimal("150000.00"),
        )

    def test_vendedor_conserva_registro_de_ventas(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            {
                "cliente_id": self.cliente.id,
                "fecha": date.today().isoformat(),
                "estado_pago": "pendiente",
                "lineas": [
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                        "precio_venta": "150000.00",
                    }
                ],
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )

    def _payload_venta_cliente(self, **overrides):
        payload = {
            "cliente_nombre": "Cliente manual",
            "cliente_telefono": "3009990001",
            "fecha": date.today().isoformat(),
            "estado_pago": "pendiente",
            "lineas": [
                {
                    "presentacion_id": self.presentacion.id,
                    "cantidad": 1,
                    "precio_venta": "150000.00",
                }
            ],
        }
        payload.update(overrides)
        return payload

    def test_venta_crea_cliente_nuevo_por_telefono(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload_venta_cliente(),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        cliente = Cliente.objects.get(
            id=respuesta.data["cliente"]
        )
        self.assertEqual(cliente.nombre, "Cliente manual")
        self.assertEqual(
            cliente.telefono,
            "+573009990001",
        )

    def test_venta_reutiliza_cliente_existente_por_telefono(
        self,
    ):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload_venta_cliente(
                cliente_nombre="Nombre distinto",
                cliente_telefono="300 123 0000",
            ),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            respuesta.data["cliente"],
            self.cliente.id,
        )
        self.cliente.refresh_from_db()
        self.assertEqual(
            self.cliente.nombre,
            "Clienta finanzas",
        )
        self.assertEqual(
            Cliente.objects.filter(
                telefono__in=[
                    "3001230000",
                    "+573001230000",
                ]
            ).count(),
            1,
        )

    def test_ventas_con_mismo_telefono_no_duplican_cliente(
        self,
    ):
        self.client.force_authenticate(user=self.admin)

        for _ in range(2):
            respuesta = self.client.post(
                "/api/v1/finanzas/ventas/registrar/",
                self._payload_venta_cliente(),
                format="json",
            )
            self.assertEqual(
                respuesta.status_code,
                status.HTTP_201_CREATED,
            )

        self.assertEqual(
            Cliente.objects.filter(
                telefono="+573009990001",
            ).count(),
            1,
        )

    def test_venta_sin_telefono_no_une_por_nombre(self):
        self.client.force_authenticate(user=self.admin)
        existentes = Cliente.objects.count()

        for _ in range(2):
            respuesta = self.client.post(
                "/api/v1/finanzas/ventas/registrar/",
                self._payload_venta_cliente(
                    cliente_nombre="Cliente sin teléfono",
                    cliente_telefono="",
                ),
                format="json",
            )
            self.assertEqual(
                respuesta.status_code,
                status.HTTP_201_CREATED,
            )

        self.assertEqual(
            Cliente.objects.count(),
            existentes + 2,
        )

    def test_venta_telefono_invalido_no_crea_cliente_ni_venta(
        self,
    ):
        self.client.force_authenticate(user=self.admin)
        ventas_antes = Venta.objects.count()
        clientes_antes = Cliente.objects.count()

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload_venta_cliente(
                cliente_telefono="abc",
            ),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Venta.objects.count(), ventas_antes)
        self.assertEqual(Cliente.objects.count(), clientes_antes)

    def test_venta_fallida_no_deja_cliente_nuevo(self):
        self.client.force_authenticate(user=self.admin)
        ventas_antes = Venta.objects.count()
        clientes_antes = Cliente.objects.count()
        payload = self._payload_venta_cliente(
            cliente_nombre="Cliente que no debe persistir",
            cliente_telefono="3009990002",
        )
        payload["lineas"][0]["presentacion_id"] = 999999

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            payload,
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Venta.objects.count(), ventas_antes)
        self.assertEqual(Cliente.objects.count(), clientes_antes)
        self.assertFalse(
            Cliente.objects.filter(
                nombre="Cliente que no debe persistir"
            ).exists()
        )

    def test_venta_requiere_nombre_si_no_envia_cliente(self):
        self.client.force_authenticate(user=self.admin)
        ventas_antes = Venta.objects.count()

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload_venta_cliente(
                cliente_nombre="",
                cliente_telefono="",
            ),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Venta.objects.count(), ventas_antes)

    def test_vendedor_no_accede_a_reportes_globales(self):
        self.client.force_authenticate(user=self.vendedor)

        urls = [
            "/api/v1/finanzas/reportes/clientes-con-saldo/",
            "/api/v1/finanzas/reportes/ganancia-por-producto/",
            "/api/v1/finanzas/reportes/resumen-mensual/",
            (
                "/api/v1/finanzas/reportes/balance/"
                f"?fecha_inicio={date.today().isoformat()}"
                f"&fecha_fin={date.today().isoformat()}"
            ),
        ]

        for url in urls:
            with self.subTest(url=url):
                respuesta = self.client.get(url)
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_403_FORBIDDEN,
                )

    def test_admin_accede_a_reportes_globales(self):
        self.client.force_authenticate(user=self.admin)

        urls = [
            "/api/v1/finanzas/reportes/clientes-con-saldo/",
            "/api/v1/finanzas/reportes/ganancia-por-producto/",
            "/api/v1/finanzas/reportes/resumen-mensual/",
            (
                "/api/v1/finanzas/reportes/balance/"
                f"?fecha_inicio={date.today().isoformat()}"
                f"&fecha_fin={date.today().isoformat()}"
            ),
        ]

        for url in urls:
            with self.subTest(url=url):
                respuesta = self.client.get(url)
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_200_OK,
                )

    def test_vendedor_no_accede_a_compras_ni_proveedores(self):
        self.client.force_authenticate(user=self.vendedor)

        urls = [
            "/api/v1/finanzas/compras/",
            "/api/v1/finanzas/proveedores/",
        ]

        for url in urls:
            with self.subTest(url=url):
                respuesta = self.client.get(url)
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_403_FORBIDDEN,
                )

        respuesta = self.client.post(
            "/api/v1/finanzas/proveedores/",
            {"nombre": "Proveedor no autorizado"},
            format="json",
        )
        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )

        respuesta = self.client.post(
            "/api/v1/finanzas/compras/registrar/",
            {
                "proveedor_id": 1,
                "fecha": date.today().isoformat(),
                "lineas": [
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                        "costo_unitario": "50000.00",
                    }
                ],
            },
            format="json",
        )
        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_vendedor_puede_consultar_clientes(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.get("/api/v1/finanzas/clientes/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

    def test_admin_puede_crear_cliente(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/finanzas/clientes/",
            {
                "nombre": "Cliente creado por admin",
                "telefono": "+573001110001",
                "notas": "Creado desde la API",
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            respuesta.data["nombre"],
            "Cliente creado por admin",
        )
        self.assertEqual(
            respuesta.data["telefono"],
            "+573001110001",
        )
        self.assertTrue(
            Cliente.objects.filter(
                id=respuesta.data["id"],
                telefono="+573001110001",
            ).exists()
        )

    def test_vendedor_puede_crear_cliente(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.post(
            "/api/v1/finanzas/clientes/",
            {
                "nombre": "Cliente creado por vendedor",
                "telefono": "+573001110002",
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertTrue(
            Cliente.objects.filter(
                telefono="+573001110002",
            ).exists()
        )

    def test_visitante_no_puede_crear_cliente(self):
        respuesta = self.client.post(
            "/api/v1/finanzas/clientes/",
            {
                "nombre": "Cliente sin sesión",
                "telefono": "+573001110003",
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )
        self.assertFalse(
            Cliente.objects.filter(
                telefono="+573001110003",
            ).exists()
        )

    def test_visitante_no_accede_a_endpoints_financieros(self):
        urls = [
            "/api/v1/finanzas/clientes/",
            "/api/v1/finanzas/proveedores/",
            "/api/v1/finanzas/compras/",
            "/api/v1/finanzas/ventas/",
            "/api/v1/finanzas/reportes/ganancia-por-producto/",
            "/api/v1/finanzas/reportes/resumen-mensual/",
            "/api/v1/finanzas/reportes/clientes-con-saldo/",
        ]

        for url in urls:
            with self.subTest(url=url):
                respuesta = self.client.get(url)
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_401_UNAUTHORIZED,
                )


class ComprasApiTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_compras_api",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(
            nombre="Categoría compras API"
        )
        cls.producto = Producto.objects.create(
            categoria=categoria,
            nombre="Producto compras API",
            precio=Decimal("150000.00"),
        )
        cls.presentacion = PresentacionProducto.objects.create(
            producto=cls.producto,
            porcentaje=40,
            es_personalizada=False,
        )
        cls.proveedor = Proveedor.objects.create(
            nombre="Proveedor compras API"
        )

    def setUp(self):
        self.client.force_authenticate(user=self.admin)

    def _payload(self, **overrides):
        data = {
            "proveedor_id": self.proveedor.id,
            "fecha": date.today().isoformat(),
            "lineas": [
                {
                    "presentacion_id": self.presentacion.id,
                    "cantidad": 3,
                    "costo_unitario": "25000.00",
                }
            ],
        }
        data.update(overrides)
        return data

    def test_admin_registra_compra_y_backend_calcula_total(self):
        respuesta = self.client.post(
            "/api/v1/finanzas/compras/registrar/",
            self._payload(),
            format="json",
            HTTP_IDEMPOTENCY_KEY="compra-api-0001",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        self.assertEqual(respuesta.data["total"], "75000.00")
        self.assertEqual(
            respuesta.data["proveedor"],
            self.proveedor.id,
        )
        self.assertEqual(len(respuesta.data["detalles"]), 1)
        self.assertEqual(
            respuesta.data["detalles"][0]["presentacion"],
            self.presentacion.id,
        )

        compra = Compra.objects.get()
        self.assertEqual(compra.registrado_por, self.admin)
        self.assertEqual(compra.total, Decimal("75000.00"))

    def test_compra_invalida_no_crea_registros_parciales(self):
        respuesta = self.client.post(
            "/api/v1/finanzas/compras/registrar/",
            self._payload(
                lineas=[
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                        "costo_unitario": "25000.00",
                    },
                    {
                        "presentacion_id": 999999,
                        "cantidad": 1,
                        "costo_unitario": "30000.00",
                    },
                ]
            ),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Compra.objects.count(), 0)
        self.assertEqual(DetalleCompra.objects.count(), 0)

    def test_costo_vigente_usa_compra_mas_reciente_por_fecha(self):
        self.client.post(
            "/api/v1/finanzas/compras/registrar/",
            self._payload(
                fecha="2026-01-10",
                lineas=[
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                        "costo_unitario": "10000.00",
                    }
                ],
            ),
            format="json",
            HTTP_IDEMPOTENCY_KEY="compra-costo-0001",
        )
        self.client.post(
            "/api/v1/finanzas/compras/registrar/",
            self._payload(
                fecha="2026-02-10",
                lineas=[
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                        "costo_unitario": "20000.00",
                    }
                ],
            ),
            format="json",
            HTTP_IDEMPOTENCY_KEY="compra-costo-0002",
        )

        self.assertEqual(
            costo_unitario_vigente(self.presentacion.id),
            Decimal("20000.00"),
        )

        self.client.post(
            "/api/v1/finanzas/compras/registrar/",
            self._payload(
                fecha="2026-01-01",
                lineas=[
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 1,
                        "costo_unitario": "5000.00",
                    }
                ],
            ),
            format="json",
            HTTP_IDEMPOTENCY_KEY="compra-costo-0003",
        )

        self.assertEqual(
            costo_unitario_vigente(self.presentacion.id),
            Decimal("20000.00"),
        )


class PagosInicialesTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_pagos",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(
            nombre="Categoría pagos"
        )
        producto = Producto.objects.create(
            categoria=categoria,
            nombre="Producto pagos",
            precio=Decimal("150000.00"),
        )
        cls.presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=60,
            es_personalizada=False,
        )
        proveedor = Proveedor.objects.create(
            nombre="Proveedor pagos"
        )
        compra = Compra.objects.create(
            proveedor=proveedor,
            fecha=date.today(),
            total=Decimal("50000.00"),
            registrado_por=cls.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=cls.presentacion,
            cantidad=10,
            cantidad_recibida=10,
            costo_unitario=Decimal("50000.00"),
        )
        cls.cliente = Cliente.objects.create(
            nombre="Clienta pagos",
            telefono="3001239999",
        )

    def _payload(self, **overrides):
        payload = {
            "cliente_id": self.cliente.id,
            "fecha": date.today().isoformat(),
            "estado_pago": "pendiente",
            "lineas": [
                {
                    "presentacion_id": self.presentacion.id,
                    "cantidad": 1,
                    "precio_venta": "150000.00",
                }
            ],
        }
        payload.update(overrides)
        return payload

    def _crear_venta_pendiente(self):
        self.client.force_authenticate(user=self.admin)
        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(estado_pago="pendiente"),
            format="json",
        )
        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        return Venta.objects.get(pk=respuesta.data["id"])

    def test_venta_pagada_crea_un_unico_abono_inicial(self):
        self.client.force_authenticate(user=self.admin)
        fecha_venta = date.today() - timedelta(days=5)
        fecha_pago = date.today()

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(
                fecha=fecha_venta.isoformat(),
                fecha_pago=fecha_pago.isoformat(),
                estado_pago="pagado",
            ),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        venta = Venta.objects.get(pk=respuesta.data["id"])
        abonos = Abono.objects.filter(venta=venta)

        self.assertEqual(venta.total, Decimal("150000.00"))
        self.assertEqual(venta.saldo, Decimal("0.00"))
        self.assertEqual(venta.estado_pago, "pagado")
        self.assertEqual(abonos.count(), 1)
        abono = abonos.get()
        self.assertEqual(abono.monto, Decimal("150000.00"))
        self.assertEqual(abono.tipo, Abono.Tipo.INICIAL)
        self.assertEqual(abono.fecha, fecha_pago)
        self.assertIsNotNone(abono.creado_en)
        self.assertEqual(venta.fecha, fecha_venta)

    def test_venta_abonada_exige_monto_y_crea_abono_inicial(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(
                estado_pago="abonado",
                monto_inicial="50000.00",
            ),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        venta = Venta.objects.get(pk=respuesta.data["id"])
        abonos = Abono.objects.filter(venta=venta)

        self.assertEqual(venta.estado_pago, "abonado")
        self.assertEqual(venta.total, Decimal("150000.00"))
        self.assertEqual(venta.saldo, Decimal("100000.00"))
        self.assertEqual(abonos.count(), 1)
        self.assertEqual(
            abonos.get().monto,
            Decimal("50000.00"),
        )
        self.assertEqual(abonos.get().tipo, Abono.Tipo.INICIAL)

    def test_venta_abonada_sin_monto_es_rechazada(self):
        self.client.force_authenticate(user=self.admin)
        ventas_antes = Venta.objects.count()
        abonos_antes = Abono.objects.count()

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(estado_pago="abonado"),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Venta.objects.count(), ventas_antes)
        self.assertEqual(Abono.objects.count(), abonos_antes)

    def test_venta_pagada_con_monto_distinto_es_rechazada(self):
        self.client.force_authenticate(user=self.admin)
        ventas_antes = Venta.objects.count()
        abonos_antes = Abono.objects.count()

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(
                estado_pago="pagado",
                monto_inicial="100000.00",
            ),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Venta.objects.count(), ventas_antes)
        self.assertEqual(Abono.objects.count(), abonos_antes)

    def test_venta_pendiente_no_crea_abono(self):
        venta = self._crear_venta_pendiente()

        self.assertEqual(venta.estado_pago, "pendiente")
        self.assertEqual(venta.saldo, Decimal("150000.00"))
        self.assertEqual(
            Abono.objects.filter(venta=venta).count(),
            0,
        )

    def test_fecha_pago_futura_es_rechazada(self):
        self.client.force_authenticate(user=self.admin)
        ventas_antes = Venta.objects.count()

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(
                estado_pago="pagado",
                fecha_pago=(
                    date.today() + timedelta(days=1)
                ).isoformat(),
            ),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Venta.objects.count(), ventas_antes)

    def test_abono_posterior_es_idempotente(self):
        venta = self._crear_venta_pendiente()
        self.client.force_authenticate(user=self.admin)
        url = f"/api/v1/finanzas/ventas/{venta.id}/abonos/"
        clave = "clave-pago-001"

        primera = self.client.post(
            url,
            {
                "monto": "50000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=clave,
        )
        segunda = self.client.post(
            url,
            {
                "monto": "50000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=clave,
        )
        conflicto = self.client.post(
            url,
            {
                "monto": "60000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=clave,
        )

        self.assertEqual(
            primera.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            segunda.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            conflicto.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(
            Abono.objects.filter(venta=venta).count(),
            1,
        )
        venta.refresh_from_db()
        self.assertEqual(venta.saldo, Decimal("100000.00"))
        abono = Abono.objects.get(venta=venta)
        self.assertEqual(abono.tipo, Abono.Tipo.POSTERIOR)
        self.assertEqual(abono.clave_idempotencia, clave)

    def test_idempotency_key_invalida_es_rechazada(self):
        venta = self._crear_venta_pendiente()
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            f"/api/v1/finanzas/ventas/{venta.id}/abonos/",
            {
                "monto": "50000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY="corta",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            Abono.objects.filter(venta=venta).count(),
            0,
        )

    def test_abono_sin_idempotency_key_es_rechazado(self):
        venta = self._crear_venta_pendiente()
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            f"/api/v1/finanzas/ventas/{venta.id}/abonos/",
            {
                "monto": "50000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            Abono.objects.filter(venta=venta).count(),
            0,
        )
        venta.refresh_from_db()
        self.assertEqual(venta.saldo, Decimal("150000.00"))

    def test_abono_no_puede_superar_el_saldo(self):
        venta = self._crear_venta_pendiente()
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            f"/api/v1/finanzas/ventas/{venta.id}/abonos/",
            {
                "monto": "200000.00",
                "fecha": date.today().isoformat(),
            },
            format="json",
            HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            Abono.objects.filter(venta=venta).count(),
            0,
        )
        venta.refresh_from_db()
        self.assertEqual(venta.saldo, Decimal("150000.00"))
        self.assertGreaterEqual(venta.saldo, Decimal("0.00"))

    def test_creacion_de_venta_idempotente_con_misma_clave(self):
        self.client.force_authenticate(user=self.admin)
        clave = uuid.uuid4().hex
        payload = self._payload(
            estado_pago="pagado",
            fecha_pago=date.today().isoformat(),
        )

        primera = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY=clave,
        )
        segunda = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY=clave,
        )

        self.assertEqual(
            primera.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            segunda.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            primera.data["id"],
            segunda.data["id"],
        )
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(Abono.objects.count(), 1)

    def test_creacion_de_venta_con_misma_clave_y_datos_distintos(self):
        self.client.force_authenticate(user=self.admin)
        clave = uuid.uuid4().hex

        primera = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(
                estado_pago="pagado",
                fecha_pago=date.today().isoformat(),
            ),
            format="json",
            HTTP_IDEMPOTENCY_KEY=clave,
        )
        conflicto = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(
                estado_pago="pendiente",
                lineas=[
                    {
                        "presentacion_id": self.presentacion.id,
                        "cantidad": 2,
                        "precio_venta": "150000.00",
                    }
                ],
            ),
            format="json",
            HTTP_IDEMPOTENCY_KEY=clave,
        )

        self.assertEqual(
            primera.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            conflicto.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(Abono.objects.count(), 1)

    def test_ventas_con_claves_distintas_son_independientes(self):
        self.client.force_authenticate(user=self.admin)
        payload = self._payload(estado_pago="pendiente")

        primera = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
        )
        segunda = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            payload,
            format="json",
            HTTP_IDEMPOTENCY_KEY=uuid.uuid4().hex,
        )

        self.assertEqual(
            primera.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            segunda.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertNotEqual(primera.data["id"], segunda.data["id"])
        self.assertEqual(Venta.objects.count(), 2)

    def test_venta_sin_clave_conserva_compatibilidad_legacy(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(estado_pago="pendiente"),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        venta = Venta.objects.get(pk=respuesta.data["id"])
        self.assertIsNone(venta.clave_idempotencia)

    def test_venta_con_idempotency_key_invalida_es_rechazada(self):
        self.client.force_authenticate(user=self.admin)
        ventas_antes = Venta.objects.count()

        respuesta = self.client.post(
            "/api/v1/finanzas/ventas/registrar/",
            self._payload(estado_pago="pendiente"),
            format="json",
            HTTP_IDEMPOTENCY_KEY="corta",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Venta.objects.count(), ventas_antes)

    def test_fallo_del_pago_inicial_revierte_la_venta(self):
        ventas_antes = Venta.objects.count()
        abonos_antes = Abono.objects.count()

        with patch.object(
            Abono.objects,
            "create",
            side_effect=IntegrityError("fallo simulado"),
        ):
            with self.assertRaises(IntegrityError):
                registrar_venta(
                    cliente_id=self.cliente.id,
                    fecha=date.today(),
                    estado_pago="pagado",
                    lineas=[
                        {
                            "presentacion_id": self.presentacion.id,
                            "cantidad": 1,
                            "precio_venta": Decimal(
                                "150000.00"
                            ),
                        }
                    ],
                    usuario=self.admin,
                )

        self.assertEqual(Venta.objects.count(), ventas_antes)
        self.assertEqual(Abono.objects.count(), abonos_antes)


@override_settings(
    TIME_ZONE="America/Bogota",
    USE_TZ=True,
)
class FechasPagoTests(SimpleTestCase):

    def setUp(self):
        self.zona = ZoneInfo("America/Bogota")
        self.hoy = timezone.localdate()

    def test_conserva_el_dia_elegido_en_los_limites_del_dia(self):
        inicio = datetime.combine(
            self.hoy,
            time.min,
            tzinfo=self.zona,
        )
        fin = datetime.combine(
            self.hoy,
            time(23, 59, 59),
            tzinfo=self.zona,
        )

        self.assertEqual(
            normalizar_fecha_pago(inicio),
            self.hoy,
        )
        self.assertEqual(
            normalizar_fecha_pago(fin),
            self.hoy,
        )
        self.assertEqual(
            normalizar_fecha_pago(self.hoy),
            self.hoy,
        )
        self.assertEqual(
            normalizar_fecha_pago(self.hoy.isoformat()),
            self.hoy,
        )

    def test_instante_utc_cercano_a_medianoche_no_desplaza_el_dia(self):
        ayer = self.hoy - timedelta(days=1)
        instante = datetime.combine(
            ayer,
            time(23, 59),
            tzinfo=self.zona,
        ).astimezone(ZoneInfo("UTC"))

        self.assertEqual(
            normalizar_fecha_pago(instante),
            ayer,
        )

    def test_rechaza_el_dia_siguiente(self):
        manana = self.hoy + timedelta(days=1)

        with self.assertRaises(ReglaNegocioError):
            normalizar_fecha_pago(manana)


class VentasListadoConsultasTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_consultas",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(
            nombre="Categoría consultas"
        )
        producto = Producto.objects.create(
            categoria=categoria,
            nombre="Producto consultas",
            precio=Decimal("150000.00"),
        )
        cls.presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=60,
            es_personalizada=False,
        )
        proveedor = Proveedor.objects.create(
            nombre="Proveedor consultas"
        )
        compra = Compra.objects.create(
            proveedor=proveedor,
            fecha=date.today(),
            total=Decimal("50000.00"),
            registrado_por=cls.admin,
        )
        DetalleCompra.objects.create(
            compra=compra,
            presentacion=cls.presentacion,
            cantidad=10,
            cantidad_recibida=10,
            costo_unitario=Decimal("50000.00"),
        )
        cls.cliente = Cliente.objects.create(
            nombre="Clienta consultas",
            telefono="3001238888",
        )

    def _crear_venta_con_abonos(self):
        venta = registrar_venta(
            cliente_id=self.cliente.id,
            fecha=date.today(),
            estado_pago="pendiente",
            lineas=[
                {
                    "presentacion_id": self.presentacion.id,
                    "cantidad": 1,
                    "precio_venta": Decimal("150000.00"),
                }
            ],
            usuario=self.admin,
        )
        registrar_abono(
            venta_id=venta.id,
            monto=Decimal("10000.00"),
            fecha=date.today(),
            usuario=self.admin,
            clave_idempotencia=uuid.uuid4().hex,
        )
        registrar_abono(
            venta_id=venta.id,
            monto=Decimal("20000.00"),
            fecha=date.today(),
            usuario=self.admin,
            clave_idempotencia=uuid.uuid4().hex,
        )
        return venta

    def test_listado_no_crece_en_consultas_con_mas_ventas_y_abonos(
        self,
    ):
        self.client.force_authenticate(user=self.admin)
        self._crear_venta_con_abonos()

        with CaptureQueriesContext(connection) as consultas_uno:
            respuesta_uno = self.client.get(
                "/api/v1/finanzas/ventas/"
            )

        self.assertEqual(
            respuesta_uno.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(len(respuesta_uno.data), 1)
        self.assertEqual(
            len(respuesta_uno.data[0]["abonos"]),
            2,
        )

        for _ in range(4):
            self._crear_venta_con_abonos()

        with CaptureQueriesContext(connection) as consultas_cinco:
            respuesta_cinco = self.client.get(
                "/api/v1/finanzas/ventas/"
            )

        self.assertEqual(len(respuesta_cinco.data), 5)
        self.assertTrue(
            all(
                len(venta["abonos"]) == 2
                for venta in respuesta_cinco.data
            )
        )
        self.assertEqual(
            len(consultas_uno),
            len(consultas_cinco),
        )


class IdempotenciaConcurrenteTests(TransactionTestCase):

    @unittest.skipUnless(
        connection.vendor == "postgresql",
        "La prueba de concurrencia requiere PostgreSQL.",
    )
    def test_abonos_concurrentes_con_la_misma_clave_crean_uno_solo(
        self,
    ):
        admin, cliente, presentacion = self._datos_base(
            "concurrente_abono"
        )
        venta = registrar_venta(
            cliente_id=cliente.id,
            fecha=date.today(),
            estado_pago="pendiente",
            lineas=[
                {
                    "presentacion_id": presentacion.id,
                    "cantidad": 1,
                    "precio_venta": Decimal("150000.00"),
                }
            ],
            usuario=admin,
        )
        clave = uuid.uuid4().hex
        barrera = threading.Barrier(2)
        resultados = []

        def intentar_abono():
            try:
                barrera.wait(timeout=10)
                registrar_abono(
                    venta_id=venta.id,
                    monto=Decimal("50000.00"),
                    fecha=date.today(),
                    usuario=admin,
                    clave_idempotencia=clave,
                )
                resultados.append("ok")
            except Exception as exc:
                resultados.append(type(exc).__name__)
            finally:
                connection.close()

        hilos = [
            threading.Thread(target=intentar_abono)
            for _ in range(2)
        ]

        for hilo in hilos:
            hilo.start()

        for hilo in hilos:
            hilo.join(timeout=15)

        self.assertFalse(
            any(hilo.is_alive() for hilo in hilos)
        )
        self.assertEqual(resultados.count("ok"), 2)
        self.assertEqual(
            Abono.objects.filter(venta=venta).count(),
            1,
        )
        venta.refresh_from_db()
        self.assertEqual(venta.saldo, Decimal("100000.00"))

    @unittest.skipUnless(
        connection.vendor == "postgresql",
        "La prueba de concurrencia requiere PostgreSQL.",
    )
    def test_ventas_concurrentes_con_la_misma_clave_crean_una_sola(
        self,
    ):
        admin, cliente, presentacion = self._datos_base(
            "concurrente_venta"
        )
        clave = uuid.uuid4().hex
        barrera = threading.Barrier(2)
        resultados = []

        def intentar_venta():
            try:
                barrera.wait(timeout=10)
                venta = registrar_venta(
                    cliente_id=cliente.id,
                    fecha=date.today(),
                    estado_pago="pagado",
                    lineas=[
                        {
                            "presentacion_id": presentacion.id,
                            "cantidad": 1,
                            "precio_venta": Decimal("150000.00"),
                        }
                    ],
                    usuario=admin,
                    clave_idempotencia=clave,
                )
                resultados.append(venta.id)
            except Exception as exc:
                resultados.append(type(exc).__name__)
            finally:
                connection.close()

        hilos = [
            threading.Thread(target=intentar_venta)
            for _ in range(2)
        ]

        for hilo in hilos:
            hilo.start()

        for hilo in hilos:
            hilo.join(timeout=15)

        self.assertFalse(
            any(hilo.is_alive() for hilo in hilos)
        )
        self.assertEqual(
            len([r for r in resultados if isinstance(r, int)]),
            2,
        )
        self.assertEqual(Venta.objects.count(), 1)
        self.assertEqual(Abono.objects.count(), 1)
        venta = Venta.objects.get()
        self.assertEqual(venta.clave_idempotencia, clave)

    def _datos_base(self, sufijo):
        admin = Usuario.objects.create_user(
            username=f"admin_{sufijo}",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        categoria = Categoria.objects.create(
            nombre=f"Categoría {sufijo}"
        )
        producto = Producto.objects.create(
            categoria=categoria,
            nombre=f"Producto {sufijo}",
            precio=Decimal("150000.00"),
        )
        presentacion = PresentacionProducto.objects.create(
            producto=producto,
            porcentaje=60,
            es_personalizada=False,
        )
        proveedor = Proveedor.objects.create(
            nombre=f"Proveedor {sufijo}"
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
            cantidad=10,
            cantidad_recibida=10,
            costo_unitario=Decimal("50000.00"),
        )
        cliente = Cliente.objects.create(
            nombre=f"Clienta {sufijo}",
            telefono=(
                f"300{uuid.uuid4().int % 10_000_000:07d}"
            ),
        )
        return admin, cliente, presentacion
