import importlib
import io
import tempfile
from datetime import date
from decimal import Decimal

from django.apps import apps as django_apps
from django.core.files.uploadedfile import SimpleUploadedFile
from django.core.management import call_command
from django.test import override_settings
from PIL import Image
from rest_framework import status
from rest_framework.test import APITestCase

from apps.catalogo.models import (
    Categoria,
    FamiliaOlfativa,
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


class CatalogoPermisosTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_catalogo",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cls.vendedor = Usuario.objects.create_user(
            username="vendedor_catalogo",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )
        cls.superusuario = Usuario.objects.create_superuser(
            username="super_catalogo",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )

        cls.categoria_mujer, _ = Categoria.objects.get_or_create(
            nombre="Mujer"
        )
        cls.categoria_unisex, _ = Categoria.objects.get_or_create(
            nombre="Unisex"
        )

        cls.familia_floral = FamiliaOlfativa.objects.create(
            nombre="Floral"
        )
        cls.familia_amaderada = FamiliaOlfativa.objects.create(
            nombre="Amaderada"
        )
        cls.familia_citrica = FamiliaOlfativa.objects.create(
            nombre="Cítrica"
        )

        cls.producto_mujer = Producto.objects.create(
            categoria=cls.categoria_mujer,
            nombre="Perfume Mujer Floral",
            precio=Decimal("100000.00"),
        )
        cls.producto_mujer.familias_olfativas.set(
            [cls.familia_floral, cls.familia_amaderada]
        )

        cls.producto_unisex = Producto.objects.create(
            categoria=cls.categoria_unisex,
            nombre="Perfume Unisex Floral",
            precio=Decimal("120000.00"),
        )
        cls.producto_unisex.familias_olfativas.set(
            [cls.familia_floral]
        )

        cls.producto_inactivo = Producto.objects.create(
            categoria=cls.categoria_mujer,
            nombre="Perfume Inactivo",
            precio=Decimal("50000.00"),
            activo=False,
        )

        cls.producto_sin_precio = Producto.objects.create(
            categoria=cls.categoria_mujer,
            nombre="Perfume Sin Precio",
            precio=None,
            activo=True,
        )

        cls.presentacion = PresentacionProducto.objects.create(
            producto=cls.producto_mujer,
            porcentaje=40,
            es_personalizada=False,
        )

    def test_visitante_puede_listar_catalogo_publico(self):
        urls = [
            "/api/v1/catalogo/categorias/",
            f"/api/v1/catalogo/categorias/{self.categoria_mujer.id}/",
            "/api/v1/catalogo/familias-olfativas/",
            f"/api/v1/catalogo/familias-olfativas/{self.familia_floral.id}/",
            "/api/v1/catalogo/productos/",
            f"/api/v1/catalogo/productos/{self.producto_mujer.id}/",
        ]

        for url in urls:
            with self.subTest(url=url):
                respuesta = self.client.get(url)
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_200_OK,
                )

    def test_categorias_iniciales_de_publico_objetivo(self):
        nombres = set(
            Categoria.objects.filter(
                nombre__in=["Mujer", "Hombre", "Unisex"]
            ).values_list("nombre", flat=True)
        )

        self.assertEqual(
            nombres,
            {"Mujer", "Hombre", "Unisex"},
        )

    def test_catalogo_publico_no_expone_porcentajes(self):
        respuesta = self.client.get(
            f"/api/v1/catalogo/productos/{self.producto_mujer.id}/"
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertNotIn("presentaciones", respuesta.data)
        self.assertNotIn("porcentaje", respuesta.data)
        self.assertNotIn("porcentaje_recarga", respuesta.data)

    def test_visitante_no_puede_consultar_presentaciones_internas(self):
        for url in (
            "/api/v1/catalogo/presentaciones/",
            f"/api/v1/catalogo/presentaciones/{self.presentacion.id}/",
        ):
            with self.subTest(url=url):
                respuesta = self.client.get(url)
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_401_UNAUTHORIZED,
                )

    def test_vendedor_no_puede_consultar_presentaciones_internas(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.get(
            "/api/v1/catalogo/presentaciones/"
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_admin_puede_consultar_presentaciones_internas(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.get(
            "/api/v1/catalogo/presentaciones/"
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)

    def test_visitante_no_puede_crear_catalogo(self):
        respuestas = [
            self.client.post(
                "/api/v1/catalogo/categorias/",
                {"nombre": "No autorizada"},
                format="json",
            ),
            self.client.post(
                "/api/v1/catalogo/productos/",
                {
                    "categoria": self.categoria_mujer.id,
                    "nombre": "No autorizado",
                    "precio": "100000.00",
                    "dias_entrega": 1,
                },
                format="json",
            ),
            self.client.post(
                "/api/v1/catalogo/familias-olfativas/",
                {"nombre": "No autorizada"},
                format="json",
            ),
            self.client.post(
                "/api/v1/catalogo/presentaciones/",
                {
                    "producto": self.producto_mujer.id,
                    "porcentaje": 60,
                },
                format="json",
            ),
        ]

        for respuesta in respuestas:
            self.assertEqual(
                respuesta.status_code,
                status.HTTP_401_UNAUTHORIZED,
            )

    def test_visitante_no_puede_editar_ni_eliminar_catalogo(self):
        respuestas = [
            self.client.patch(
                f"/api/v1/catalogo/categorias/{self.categoria_mujer.id}/",
                {"nombre": "Cambio no autorizado"},
                format="json",
            ),
            self.client.delete(
                f"/api/v1/catalogo/categorias/{self.categoria_mujer.id}/"
            ),
            self.client.patch(
                f"/api/v1/catalogo/productos/{self.producto_mujer.id}/",
                {"nombre": "Cambio no autorizado"},
                format="json",
            ),
            self.client.delete(
                f"/api/v1/catalogo/productos/{self.producto_mujer.id}/"
            ),
            self.client.patch(
                f"/api/v1/catalogo/familias-olfativas/{self.familia_floral.id}/",
                {"nombre": "Cambio no autorizado"},
                format="json",
            ),
            self.client.delete(
                f"/api/v1/catalogo/familias-olfativas/{self.familia_floral.id}/"
            ),
            self.client.patch(
                f"/api/v1/catalogo/presentaciones/{self.presentacion.id}/",
                {"activo": False},
                format="json",
            ),
            self.client.delete(
                f"/api/v1/catalogo/presentaciones/{self.presentacion.id}/"
            ),
        ]

        for respuesta in respuestas:
            self.assertEqual(
                respuesta.status_code,
                status.HTTP_401_UNAUTHORIZED,
            )

    def test_vendedor_puede_consultar_catalogo_publico(self):
        self.client.force_authenticate(user=self.vendedor)

        for url in (
            "/api/v1/catalogo/categorias/",
            "/api/v1/catalogo/productos/",
            "/api/v1/catalogo/familias-olfativas/",
        ):
            with self.subTest(url=url):
                respuesta = self.client.get(url)
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_200_OK,
                )

    def test_vendedor_no_puede_modificar_catalogo(self):
        self.client.force_authenticate(user=self.vendedor)

        respuestas = [
            self.client.post(
                "/api/v1/catalogo/categorias/",
                {"nombre": "Categoría de vendedor"},
                format="json",
            ),
            self.client.patch(
                f"/api/v1/catalogo/productos/{self.producto_mujer.id}/",
                {"nombre": "Producto modificado"},
                format="json",
            ),
            self.client.post(
                "/api/v1/catalogo/familias-olfativas/",
                {"nombre": "Familia de vendedor"},
                format="json",
            ),
            self.client.delete(
                f"/api/v1/catalogo/presentaciones/{self.presentacion.id}/"
            ),
        ]

        for respuesta in respuestas:
            self.assertEqual(
                respuesta.status_code,
                status.HTTP_403_FORBIDDEN,
            )

    def test_admin_puede_listar_todos_los_productos(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.get(
            "/api/v1/catalogo/productos/admin/"
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        ids = {producto["id"] for producto in respuesta.data}
        self.assertIn(self.producto_mujer.id, ids)
        self.assertIn(self.producto_unisex.id, ids)
        self.assertIn(self.producto_inactivo.id, ids)
        self.assertIn(self.producto_sin_precio.id, ids)

    def test_catalogo_publico_no_incluye_inactivos_ni_sin_precio(self):
        respuesta = self.client.get("/api/v1/catalogo/productos/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        ids = {producto["id"] for producto in respuesta.data}
        self.assertNotIn(self.producto_inactivo.id, ids)
        self.assertNotIn(self.producto_sin_precio.id, ids)

    def test_vendedor_no_puede_listar_catalogo_administrativo(self):
        self.client.force_authenticate(user=self.vendedor)

        respuesta = self.client.get(
            "/api/v1/catalogo/productos/admin/"
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_403_FORBIDDEN,
        )

    def test_visitante_no_puede_listar_catalogo_administrativo(self):
        respuesta = self.client.get(
            "/api/v1/catalogo/productos/admin/"
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_401_UNAUTHORIZED,
        )

    def test_admin_puede_desactivar_y_reactivar_producto(self):
        self.client.force_authenticate(user=self.admin)

        desactivar = self.client.patch(
            f"/api/v1/catalogo/productos/{self.producto_mujer.id}/",
            {"activo": False},
            format="json",
        )

        self.assertEqual(
            desactivar.status_code,
            status.HTTP_200_OK,
        )
        self.assertFalse(desactivar.data["activo"])

        publico = self.client.get("/api/v1/catalogo/productos/")
        ids_publicos = {producto["id"] for producto in publico.data}
        self.assertNotIn(self.producto_mujer.id, ids_publicos)

        activar = self.client.patch(
            f"/api/v1/catalogo/productos/{self.producto_mujer.id}/",
            {"activo": True},
            format="json",
        )

        self.assertEqual(activar.status_code, status.HTTP_200_OK)
        self.assertTrue(activar.data["activo"])

        publico = self.client.get("/api/v1/catalogo/productos/")
        ids_publicos = {producto["id"] for producto in publico.data}
        self.assertIn(self.producto_mujer.id, ids_publicos)

    def test_admin_puede_subir_y_quitar_foto(self):
        self.client.force_authenticate(user=self.admin)

        buffer = io.BytesIO()
        Image.new("RGB", (2, 2), "white").save(
            buffer,
            format="PNG",
        )
        foto = SimpleUploadedFile(
            "producto.png",
            buffer.getvalue(),
            content_type="image/png",
        )

        with tempfile.TemporaryDirectory() as media_root:
            with override_settings(MEDIA_ROOT=media_root):
                creacion = self.client.post(
                    "/api/v1/catalogo/productos/",
                    {
                        "categoria": self.categoria_mujer.id,
                        "nombre": "Producto con foto",
                        "precio": "75000.00",
                        "contenido_ml": 50,
                        "dias_entrega": 1,
                        "foto": foto,
                    },
                    format="multipart",
                )

                self.assertEqual(
                    creacion.status_code,
                    status.HTTP_201_CREATED,
                )
                self.assertTrue(creacion.data["foto"])
                producto_id = creacion.data["id"]

                quitar = self.client.patch(
                    f"/api/v1/catalogo/productos/{producto_id}/",
                    {"foto": None},
                    format="json",
                )

                self.assertEqual(
                    quitar.status_code,
                    status.HTTP_200_OK,
                )
                self.assertIsNone(quitar.data["foto"])

    def test_admin_puede_gestionar_catalogo_y_clasificaciones(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/catalogo/familias-olfativas/",
            {"nombre": "Gourmand"},
            format="json",
        )
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        familia_id = respuesta.data["id"]

        respuesta = self.client.post(
            "/api/v1/catalogo/productos/",
            {
                "categoria": self.categoria_mujer.id,
                "familias_olfativas": [familia_id],
                "nombre": "Producto admin",
                "precio": "130000.00",
                "dias_entrega": 1,
                "activo": True,
            },
            format="json",
        )
        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        self.assertIn(
            "Gourmand",
            respuesta.data["familias_olfativas_nombres"],
        )

        producto_id = respuesta.data["id"]
        porcentajes = set(
            PresentacionProducto.objects
            .filter(producto_id=producto_id)
            .values_list("porcentaje", flat=True)
        )

        self.assertEqual(porcentajes, {40, 60, 70, 80})

        respuesta = self.client.post(
            "/api/v1/catalogo/presentaciones/",
            {
                "producto": producto_id,
                "porcentaje": 40,
                "es_personalizada": False,
                "activo": True,
            },
            format="json",
        )
        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_admin_rechaza_porcentaje_interno_invalido(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/catalogo/presentaciones/",
            {
                "producto": self.producto_mujer.id,
                "porcentaje": 55,
                "es_personalizada": False,
                "activo": True,
            },
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_400_BAD_REQUEST,
        )

    def test_superusuario_con_rol_vendedor_puede_modificar_catalogo(self):
        self.client.force_authenticate(user=self.superusuario)

        respuesta = self.client.post(
            "/api/v1/catalogo/categorias/",
            {"nombre": "Categoría superusuario"},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )

    def test_get_publico_ignora_authorization_invalido(self):
        for url in (
            "/api/v1/catalogo/categorias/",
            "/api/v1/catalogo/productos/",
            "/api/v1/catalogo/familias-olfativas/",
        ):
            with self.subTest(url=url):
                respuesta = self.client.get(
                    url,
                    HTTP_AUTHORIZATION="Bearer token-invalido",
                )
                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_200_OK,
                )

    def test_filtro_por_publico_objetivo(self):
        respuesta = self.client.get(
            "/api/v1/catalogo/productos/",
            {"categoria": self.categoria_mujer.id},
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        ids = {producto["id"] for producto in respuesta.data}
        self.assertEqual(ids, {self.producto_mujer.id})

    def test_filtro_por_nombre_de_publico(self):
        respuesta = self.client.get(
            "/api/v1/catalogo/productos/",
            {"categoria_nombre": "Unisex"},
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        ids = {producto["id"] for producto in respuesta.data}
        self.assertEqual(ids, {self.producto_unisex.id})

    def test_filtro_por_familia_olfativa(self):
        respuesta = self.client.get(
            "/api/v1/catalogo/productos/",
            {"familias_olfativas": self.familia_floral.id},
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        ids = {producto["id"] for producto in respuesta.data}
        self.assertEqual(
            ids,
            {self.producto_mujer.id, self.producto_unisex.id},
        )

    def test_filtro_por_varias_familias_no_duplica_productos(self):
        respuesta = self.client.get(
            "/api/v1/catalogo/productos/",
            {
                "familias_olfativas": (
                    f"{self.familia_floral.id},"
                    f"{self.familia_amaderada.id}"
                )
            },
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        ids = [producto["id"] for producto in respuesta.data]
        self.assertEqual(len(ids), len(set(ids)))
        self.assertIn(self.producto_mujer.id, ids)
        self.assertIn(self.producto_unisex.id, ids)

    def test_filtros_combinados(self):
        respuesta = self.client.get(
            "/api/v1/catalogo/productos/",
            {
                "categoria": self.categoria_mujer.id,
                "familias_olfativas": self.familia_floral.id,
            },
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        ids = {producto["id"] for producto in respuesta.data}
        self.assertEqual(ids, {self.producto_mujer.id})


class ProductoContenidoMlTests(APITestCase):

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_contenido_ml",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cls.categoria = Categoria.objects.create(
            nombre="Contenido mililitros"
        )

    def setUp(self):
        self.client.force_authenticate(user=self.admin)

    def _payload(self, **overrides):
        data = {
            "categoria": self.categoria.id,
            "nombre": "Perfume Floral",
            "precio": "35000.00",
            "dias_entrega": 1,
            "contenido_ml": 30,
        }
        data.update(overrides)
        return data

    def test_puede_crear_producto_de_30_ml(self):
        respuesta = self.client.post(
            "/api/v1/catalogo/productos/",
            self._payload(),
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        self.assertEqual(respuesta.data["contenido_ml"], 30)

    def test_productos_del_mismo_perfume_son_independientes(self):
        respuesta_30 = self.client.post(
            "/api/v1/catalogo/productos/",
            self._payload(contenido_ml=30, precio="35000.00"),
            format="json",
        )
        respuesta_100 = self.client.post(
            "/api/v1/catalogo/productos/",
            self._payload(contenido_ml=100, precio="90000.00"),
            format="json",
        )

        self.assertEqual(
            respuesta_30.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(
            respuesta_100.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertNotEqual(
            respuesta_30.data["id"],
            respuesta_100.data["id"],
        )
        self.assertEqual(respuesta_30.data["contenido_ml"], 30)
        self.assertEqual(respuesta_100.data["contenido_ml"], 100)
        self.assertEqual(respuesta_30.data["precio"], "35000.00")
        self.assertEqual(respuesta_100.data["precio"], "90000.00")

    def test_catalogo_publico_devuelve_contenido_ml(self):
        self.client.post(
            "/api/v1/catalogo/productos/",
            self._payload(),
            format="json",
        )
        self.client.force_authenticate(user=None)

        respuesta = self.client.get("/api/v1/catalogo/productos/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(len(respuesta.data), 1)
        self.assertEqual(respuesta.data[0]["contenido_ml"], 30)
        self.assertEqual(respuesta.data[0]["nombre"], "Perfume Floral")

    def test_puede_actualizar_contenido_ml(self):
        creacion = self.client.post(
            "/api/v1/catalogo/productos/",
            self._payload(),
            format="json",
        )
        producto_id = creacion.data["id"]

        respuesta = self.client.patch(
            f"/api/v1/catalogo/productos/{producto_id}/",
            {"contenido_ml": 100},
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertEqual(respuesta.data["contenido_ml"], 100)

    def test_rechaza_contenidos_invalidos(self):
        for contenido in (0, -10, 30.5, "abc"):
            with self.subTest(contenido=contenido):
                respuesta = self.client.post(
                    "/api/v1/catalogo/productos/",
                    self._payload(contenido_ml=contenido),
                    format="json",
                )

                self.assertEqual(
                    respuesta.status_code,
                    status.HTTP_400_BAD_REQUEST,
                )
                self.assertIn("contenido_ml", respuesta.data)

    def test_permite_producto_sin_contenido_ml(self):
        payload = self._payload()
        payload.pop("contenido_ml")

        respuesta = self.client.post(
            "/api/v1/catalogo/productos/",
            payload,
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        self.assertIsNone(respuesta.data["contenido_ml"])

        self.client.force_authenticate(user=None)
        consulta = self.client.get(
            f"/api/v1/catalogo/productos/{respuesta.data['id']}/"
        )

        self.assertEqual(consulta.status_code, status.HTTP_200_OK)
        self.assertIsNone(consulta.data["contenido_ml"])

    def test_permite_limpiar_contenido_ml(self):
        creacion = self.client.post(
            "/api/v1/catalogo/productos/",
            self._payload(),
            format="json",
        )

        respuesta = self.client.patch(
            f"/api/v1/catalogo/productos/{creacion.data['id']}/",
            {"contenido_ml": None},
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.assertIsNone(respuesta.data["contenido_ml"])


class CategoriasPredefinidasTests(APITestCase):

    NOMBRES = ("Mujer", "Hombre", "Unisex")

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_categorias",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )

    def _ejecutar_inicializacion(self):
        modulo = importlib.import_module(
            "apps.catalogo.migrations.0006_categorias_predefinidas"
        )
        modulo.crear_categorias_predefinidas(django_apps, None)

    def test_categorias_predefinidas_existen(self):
        for nombre in self.NOMBRES:
            with self.subTest(nombre=nombre):
                self.assertTrue(
                    Categoria.objects.filter(
                        nombre__iexact=nombre
                    ).exists()
                )

    def test_reejecutar_inicializacion_no_duplica(self):
        ids_antes = dict(
            Categoria.objects.filter(
                nombre__in=self.NOMBRES
            ).values_list("nombre", "id")
        )

        self._ejecutar_inicializacion()
        self._ejecutar_inicializacion()

        ids_despues = dict(
            Categoria.objects.filter(
                nombre__in=self.NOMBRES
            ).values_list("nombre", "id")
        )

        self.assertEqual(ids_antes, ids_despues)

        for nombre in self.NOMBRES:
            with self.subTest(nombre=nombre):
                self.assertEqual(
                    Categoria.objects.filter(
                        nombre__iexact=nombre
                    ).count(),
                    1,
                )

    def test_reutiliza_categoria_existente_sin_importar_mayusculas(self):
        Categoria.objects.filter(nombre__iexact="Mujer").delete()
        existente = Categoria.objects.create(nombre="mujer")

        self._ejecutar_inicializacion()

        self.assertEqual(
            Categoria.objects.filter(
                nombre__iexact="Mujer"
            ).count(),
            1,
        )
        self.assertEqual(
            Categoria.objects.get(pk=existente.pk).nombre,
            "mujer",
        )

    def test_catalogo_publico_devuelve_categorias_predefinidas(self):
        respuesta = self.client.get("/api/v1/catalogo/categorias/")

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        nombres = {categoria["nombre"] for categoria in respuesta.data}
        self.assertTrue(set(self.NOMBRES).issubset(nombres))

    def test_producto_se_crea_con_id_real_de_categoria(self):
        self.client.force_authenticate(user=self.admin)
        categoria = Categoria.objects.get(nombre="Unisex")

        respuesta = self.client.post(
            "/api/v1/catalogo/productos/",
            {
                "categoria": categoria.id,
                "nombre": "Producto Unisex",
                "precio": "50000.00",
                "contenido_ml": 50,
                "dias_entrega": 1,
            },
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_201_CREATED)
        self.assertEqual(respuesta.data["categoria"], categoria.id)
        self.assertIsNotNone(respuesta.data["id"])


class FamiliasOlfativasGestionTests(APITestCase):
    """Gestion administrativa completa de familias olfativas."""

    @classmethod
    def setUpTestData(cls):
        cls.admin = Usuario.objects.create_user(
            username="admin_familias",
            password="clave-segura-123",
            rol=Usuario.Rol.ADMIN,
        )
        cls.vendedor = Usuario.objects.create_user(
            username="vendedor_familias",
            password="clave-segura-123",
            rol=Usuario.Rol.VENDEDOR,
        )
        cls.categoria, _ = Categoria.objects.get_or_create(
            nombre="Unisex"
        )
        cls.familia_con_productos = FamiliaOlfativa.objects.create(
            nombre="Floral"
        )
        cls.familia_vacia = FamiliaOlfativa.objects.create(
            nombre="Amaderada"
        )
        cls.producto = Producto.objects.create(
            categoria=cls.categoria,
            nombre="Perfume Floral",
            precio=Decimal("90000.00"),
            contenido_ml=100,
        )
        cls.producto.familias_olfativas.add(
            cls.familia_con_productos
        )

    def test_admin_crea_familia(self):
        self.client.force_authenticate(user=self.admin)

        respuesta = self.client.post(
            "/api/v1/catalogo/familias-olfativas/",
            {"nombre": "  Gourmand  "},
            format="json",
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_201_CREATED,
        )
        self.assertEqual(respuesta.data["nombre"], "Gourmand")

    def test_admin_edita_nombre_sin_desasociar_productos(self):
        self.client.force_authenticate(user=self.admin)
        relaciones_antes = set(
            self.producto.familias_olfativas.values_list(
                "id", flat=True
            )
        )

        respuesta = self.client.patch(
            f"/api/v1/catalogo/familias-olfativas/"
            f"{self.familia_con_productos.id}/",
            {"nombre": "  Floral   Renovada  "},
            format="json",
        )

        self.assertEqual(respuesta.status_code, status.HTTP_200_OK)
        self.familia_con_productos.refresh_from_db()
        self.producto.refresh_from_db()
        self.assertEqual(
            self.familia_con_productos.nombre,
            "Floral Renovada",
        )
        self.assertEqual(
            set(
                self.producto.familias_olfativas.values_list(
                    "id", flat=True
                )
            ),
            relaciones_antes,
        )
        self.assertEqual(self.producto.nombre, "Perfume Floral")
        self.assertEqual(
            self.producto.precio,
            Decimal("90000.00"),
        )

    def test_rechaza_nombres_vacios_y_duplicados(self):
        self.client.force_authenticate(user=self.admin)

        vacio = self.client.post(
            "/api/v1/catalogo/familias-olfativas/",
            {"nombre": "   "},
            format="json",
        )
        duplicado = self.client.post(
            "/api/v1/catalogo/familias-olfativas/",
            {"nombre": "  floral  "},
            format="json",
        )
        duplicado_edicion = self.client.patch(
            f"/api/v1/catalogo/familias-olfativas/"
            f"{self.familia_vacia.id}/",
            {"nombre": " FLORAL "},
            format="json",
        )

        self.assertEqual(
            vacio.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            duplicado.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.assertEqual(
            duplicado_edicion.status_code,
            status.HTTP_400_BAD_REQUEST,
        )
        self.familia_vacia.refresh_from_db()
        self.assertEqual(self.familia_vacia.nombre, "Amaderada")

    def test_admin_elimina_familia_sin_productos(self):
        self.client.force_authenticate(user=self.admin)
        familia = FamiliaOlfativa.objects.create(
            nombre="Familia temporal"
        )
        productos_antes = Producto.objects.count()

        respuesta = self.client.delete(
            f"/api/v1/catalogo/familias-olfativas/{familia.id}/"
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_204_NO_CONTENT,
        )
        self.assertFalse(
            FamiliaOlfativa.objects.filter(pk=familia.pk).exists()
        )
        self.assertEqual(Producto.objects.count(), productos_antes)

    def test_bloquea_eliminacion_con_productos_asociados(self):
        self.client.force_authenticate(user=self.admin)
        productos_antes = Producto.objects.count()

        respuesta = self.client.delete(
            f"/api/v1/catalogo/familias-olfativas/"
            f"{self.familia_con_productos.id}/"
        )

        self.assertEqual(
            respuesta.status_code,
            status.HTTP_409_CONFLICT,
        )
        self.assertIn("productos asociados", respuesta.data["detail"])
        self.assertTrue(
            FamiliaOlfativa.objects.filter(
                pk=self.familia_con_productos.pk
            ).exists()
        )
        self.assertTrue(
            self.producto.familias_olfativas.filter(
                pk=self.familia_con_productos.pk
            ).exists()
        )
        self.assertEqual(Producto.objects.count(), productos_antes)

    def test_vendedor_no_puede_editar_ni_eliminar_familias(self):
        self.client.force_authenticate(user=self.vendedor)

        edicion = self.client.patch(
            f"/api/v1/catalogo/familias-olfativas/"
            f"{self.familia_vacia.id}/",
            {"nombre": "Cambio no autorizado"},
            format="json",
        )
        eliminacion = self.client.delete(
            f"/api/v1/catalogo/familias-olfativas/"
            f"{self.familia_vacia.id}/"
        )

        self.assertEqual(
            edicion.status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.assertEqual(
            eliminacion.status_code,
            status.HTTP_403_FORBIDDEN,
        )
        self.familia_vacia.refresh_from_db()
        self.assertEqual(self.familia_vacia.nombre, "Amaderada")
