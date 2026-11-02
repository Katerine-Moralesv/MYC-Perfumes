from decimal import Decimal

from django.conf import settings
from django.core.cache import cache
from django.test import SimpleTestCase, override_settings
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import Categoria, Producto
from apps.finanzas.models import Abono, Cliente, Venta
from apps.pedidos.models import DetallePedido, Pedido


class RegistrarPedidoTiendaTests(APITestCase):
    url = "/api/v1/pedidos/tienda/"

    def setUp(self):
        cache.clear()

        self.categoria = Categoria.objects.create(
            nombre="Mujer Tienda"
        )
        self.producto = Producto.objects.create(
            categoria=self.categoria,
            nombre="Perfume Tienda",
            descripcion="Producto de prueba",
            precio=Decimal("100000.00"),
            contenido_ml=100,
            dias_entrega=1,
            activo=True,
        )
        self.producto_inactivo = Producto.objects.create(
            categoria=self.categoria,
            nombre="Perfume Inactivo",
            precio=Decimal("80000.00"),
            contenido_ml=50,
            activo=False,
        )

    def tearDown(self):
        cache.clear()

    def _payload(
        self,
        *,
        lineas=None,
        telefono="3001234567",
        nombre_cliente="Clienta Tienda",
    ):
        return {
            "telefono": telefono,
            "nombre_cliente": nombre_cliente,
            "lineas": lineas or [
                {
                    "producto_id": self.producto.id,
                    "recarga_solicitada": False,
                    "cantidad": 2,
                }
            ],
        }

    def _post(self, *, payload=None, key="tienda-clave-0001", **extra):
        return self.client.post(
            self.url,
            payload if payload is not None else self._payload(),
            format="json",
            HTTP_IDEMPOTENCY_KEY=key,
            **extra,
        )

    def test_crea_pedido_pendiente_sin_venta_ni_abono(self):
        respuesta = self._post()

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(respuesta.data["estado"], "pendiente")
        self.assertEqual(
            Decimal(str(respuesta.data["total"])),
            Decimal("200000.00"),
        )
        self.assertFalse(respuesta.data["reutilizado"])
        self.assertTrue(respuesta.data["precios_completos"])
        self.assertEqual(len(respuesta.data["detalles"]), 1)

        detalle = respuesta.data["detalles"][0]
        self.assertEqual(detalle["porcentaje_recarga"], 40)
        self.assertFalse(detalle["recarga_solicitada"])
        self.assertFalse(detalle["precio_pendiente"])
        self.assertEqual(
            Decimal(str(detalle["precio_unitario"])),
            Decimal("100000.00"),
        )
        self.assertEqual(
            Decimal(str(detalle["subtotal"])),
            Decimal("200000.00"),
        )

        for campo_interno in (
            "cliente",
            "telefono_origen",
            "venta",
            "estado_pago",
            "saldo",
            "monto_pagado",
            "motivo_rechazo",
        ):
            self.assertNotIn(campo_interno, respuesta.data)

        pedido = Pedido.objects.get()
        self.assertEqual(pedido.estado, Pedido.Estado.PENDIENTE)
        self.assertEqual(pedido.detalles.count(), 1)
        self.assertEqual(pedido.clave_idempotencia, "tienda-clave-0001")
        self.assertEqual(len(pedido.hash_solicitud), 64)
        self.assertEqual(Cliente.objects.count(), 1)
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

    def test_recarga_70_queda_pendiente_de_precio(self):
        respuesta = self._post(
            key="tienda-clave-70",
            payload=self._payload(
                lineas=[
                    {
                        "producto_id": self.producto.id,
                        "recarga_solicitada": True,
                        "porcentaje": 70,
                        "cantidad": 1,
                    }
                ]
            ),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(respuesta.data["estado"], "pendiente")
        self.assertEqual(
            Decimal(str(respuesta.data["total"])),
            Decimal("0.00"),
        )
        self.assertFalse(respuesta.data["precios_completos"])

        detalle = respuesta.data["detalles"][0]
        self.assertEqual(detalle["porcentaje_recarga"], 70)
        self.assertTrue(detalle["recarga_solicitada"])
        self.assertTrue(detalle["precio_pendiente"])
        self.assertEqual(
            Decimal(str(detalle["precio_unitario"])),
            Decimal("0.00"),
        )
        self.assertEqual(Venta.objects.count(), 0)
        self.assertEqual(Abono.objects.count(), 0)

    def test_misma_clave_y_misma_solicitud_es_idempotente(self):
        primera = self._post(key="tienda-clave-repetida")
        segunda = self._post(key="tienda-clave-repetida")

        self.assertEqual(
            primera.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            segunda.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            primera.data["id"],
            segunda.data["id"],
        )
        self.assertFalse(primera.data["reutilizado"])
        self.assertTrue(segunda.data["reutilizado"])
        self.assertEqual(Pedido.objects.count(), 1)
        self.assertEqual(DetallePedido.objects.count(), 1)

    def test_misma_clave_con_solicitud_distinta_devuelve_conflicto(self):
        primera = self._post(key="tienda-clave-conflicto")
        segunda = self._post(
            key="tienda-clave-conflicto",
            payload=self._payload(
                lineas=[
                    {
                        "producto_id": self.producto.id,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    }
                ]
            ),
        )

        self.assertEqual(
            primera.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            segunda.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertEqual(Pedido.objects.count(), 1)

    def test_falta_idempotency_key(self):
        respuesta = self.client.post(
            self.url,
            self._payload(),
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertIn("Idempotency-Key", respuesta.data["detail"])
        self.assertEqual(Pedido.objects.count(), 0)

    def test_idempotency_key_invalida(self):
        respuesta = self._post(key="corta")

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    def test_maximo_de_lineas_por_pedido(self):
        lineas = [
            {
                "producto_id": self.producto.id,
                "recarga_solicitada": False,
                "cantidad": 1,
            }
            for _ in range(21)
        ]

        respuesta = self._post(
            key="tienda-clave-max-lineas",
            payload=self._payload(lineas=lineas),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    def test_telefono_invalido(self):
        respuesta = self._post(
            key="tienda-clave-telefono",
            payload=self._payload(telefono="abc"),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    def test_nombre_cliente_obligatorio(self):
        respuesta = self._post(
            key="tienda-clave-nombre",
            payload=self._payload(nombre_cliente="   "),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    def test_cantidades_invalidas(self):
        for cantidad in (0, 101):
            with self.subTest(cantidad=cantidad):
                respuesta = self._post(
                    key=f"tienda-clave-cantidad-{cantidad}",
                    payload=self._payload(
                        lineas=[
                            {
                                "producto_id": self.producto.id,
                                "recarga_solicitada": False,
                                "cantidad": cantidad,
                            }
                        ]
                    ),
                )

                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertEqual(Pedido.objects.count(), 0)

    def test_producto_inexistente(self):
        respuesta = self._post(
            key="tienda-clave-inexistente",
            payload=self._payload(
                lineas=[
                    {
                        "producto_id": 999999,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    }
                ]
            ),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    def test_producto_inactivo(self):
        respuesta = self._post(
            key="tienda-clave-inactivo",
            payload=self._payload(
                lineas=[
                    {
                        "producto_id": self.producto_inactivo.id,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    }
                ]
            ),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    def test_porcentajes_invalidos(self):
        casos = (
            {"recarga_solicitada": True, "porcentaje": 50},
            {"recarga_solicitada": True, "porcentaje": 40},
            {"recarga_solicitada": False, "porcentaje": 60},
        )

        for indice, caso in enumerate(casos):
            with self.subTest(caso=caso):
                respuesta = self._post(
                    key=f"tienda-clave-porcentaje-{indice}",
                    payload=self._payload(
                        lineas=[
                            {
                                "producto_id": self.producto.id,
                                "cantidad": 1,
                                **caso,
                            }
                        ]
                    ),
                )

                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertEqual(Pedido.objects.count(), 0)

    def test_campos_financieros_no_permitidos(self):
        payload = self._payload()
        payload["precio"] = "1.00"
        payload["total"] = "1.00"
        payload["estado"] = "confirmado"

        respuesta = self._post(
            key="tienda-clave-precio",
            payload=payload,
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

        payload_linea = self._payload()
        payload_linea["lineas"][0]["precio_unitario"] = "1.00"

        respuesta_linea = self._post(
            key="tienda-clave-precio-linea",
            payload=payload_linea,
        )

        self.assertEqual(
            respuesta_linea.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    def test_linea_invalida_no_deja_pedido_parcial(self):
        respuesta = self._post(
            key="tienda-clave-parcial",
            payload=self._payload(
                lineas=[
                    {
                        "producto_id": self.producto.id,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    },
                    {
                        "producto_id": 999999,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    },
                ]
            ),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)
        self.assertEqual(DetallePedido.objects.count(), 0)
        self.assertEqual(Cliente.objects.count(), 0)

    def test_duplicado_mismo_producto_y_porcentaje(self):
        respuesta = self._post(
            key="tienda-clave-duplicada",
            payload=self._payload(
                lineas=[
                    {
                        "producto_id": self.producto.id,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    },
                    {
                        "producto_id": self.producto.id,
                        "recarga_solicitada": False,
                        "cantidad": 1,
                    },
                ]
            ),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    def test_authorization_invalido_no_bloquea_endpoint_publico(self):
        respuesta = self._post(
            key="tienda-clave-auth",
            HTTP_AUTHORIZATION="Bearer token-invalido",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(Pedido.objects.count(), 1)

    @override_settings(
        CORS_ALLOWED_ORIGINS=[
            "https://myc-perfumes.pages.dev"
        ]
    )
    def test_preflight_desde_cloudflare_permite_idempotency_key(self):
        origen = "https://myc-perfumes.pages.dev"

        respuesta = self.client.options(
            self.url,
            HTTP_ORIGIN=origen,
            HTTP_ACCESS_CONTROL_REQUEST_METHOD="POST",
            HTTP_ACCESS_CONTROL_REQUEST_HEADERS=(
                "content-type,authorization,idempotency-key"
            ),
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            origen,
        )
        self.assertIn(
            "POST",
            respuesta["access-control-allow-methods"],
        )

        encabezados = respuesta[
            "access-control-allow-headers"
        ].lower()

        self.assertIn("content-type", encabezados)
        self.assertIn("authorization", encabezados)
        self.assertIn("idempotency-key", encabezados)

    @override_settings(
        CORS_ALLOWED_ORIGINS=[
            "https://myc-perfumes.pages.dev"
        ]
    )
    def test_post_desde_cloudflare_incluye_cors(self):
        origen = "https://myc-perfumes.pages.dev"

        respuesta = self._post(
            key="cors-clave-0001",
            HTTP_ORIGIN=origen,
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            origen,
        )
        self.assertEqual(Pedido.objects.count(), 1)

    @override_settings(
        CORS_ALLOWED_ORIGINS=[
            "https://myc-perfumes.pages.dev"
        ]
    )
    def test_error_por_falta_de_idempotency_key_incluye_cors(self):
        origen = "https://myc-perfumes.pages.dev"

        respuesta = self.client.post(
            self.url,
            self._payload(),
            format="json",
            HTTP_ORIGIN=origen,
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            origen,
        )
        self.assertIn("Idempotency-Key", respuesta.data["detail"])
        self.assertEqual(Pedido.objects.count(), 0)

    @override_settings(
        CORS_ALLOWED_ORIGINS=[
            "https://myc-perfumes.pages.dev"
        ]
    )
    def test_error_de_validacion_incluye_cors(self):
        origen = "https://myc-perfumes.pages.dev"
        payload = {
            **self._payload(),
            "lineas": [],
        }

        respuesta = self.client.post(
            self.url,
            payload,
            format="json",
            HTTP_ORIGIN=origen,
            HTTP_IDEMPOTENCY_KEY="cors-clave-error-0001",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            respuesta["access-control-allow-origin"],
            origen,
        )
        self.assertEqual(Pedido.objects.count(), 0)

    @override_settings(
        CORS_ALLOWED_ORIGINS=[
            "https://myc-perfumes.pages.dev"
        ]
    )
    def test_reintento_idempotente_desde_cloudflare_incluye_cors(self):
        origen = "https://myc-perfumes.pages.dev"

        primera = self._post(
            key="cors-clave-idempotente-0001",
            HTTP_ORIGIN=origen,
        )
        segunda = self._post(
            key="cors-clave-idempotente-0001",
            HTTP_ORIGIN=origen,
        )

        self.assertEqual(
            primera.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            segunda.status_code,
            status.HTTP_200_OK,
        )
        self.assertEqual(
            primera["access-control-allow-origin"],
            origen,
        )
        self.assertEqual(
            segunda["access-control-allow-origin"],
            origen,
        )
        self.assertEqual(primera.data["id"], segunda.data["id"])
        self.assertEqual(Pedido.objects.count(), 1)


class CorsConfiguracionTests(SimpleTestCase):
    def test_origen_de_cloudflare_esta_permitido(self):
        self.assertIn(
            "https://myc-perfumes.pages.dev",
            settings.CORS_ALLOWED_ORIGINS,
        )

    def test_idempotency_key_esta_en_encabezados_permitidos(self):
        encabezados = {
            encabezado.lower()
            for encabezado in settings.CORS_ALLOW_HEADERS
        }

        self.assertIn("authorization", encabezados)
        self.assertIn("content-type", encabezados)
        self.assertIn("idempotency-key", encabezados)

    def test_no_se_habilitan_credenciales_cors(self):
        self.assertFalse(settings.CORS_ALLOW_CREDENTIALS)
