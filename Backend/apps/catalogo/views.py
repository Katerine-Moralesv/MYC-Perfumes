
from rest_framework import generics
from rest_framework.permissions import AllowAny, IsAuthenticated

from apps.catalogo.filters import ProductoFilter
from apps.core.exceptions import ConflictoError
from apps.catalogo.models import (
    Categoria,
    FamiliaOlfativa,
    Producto,
    PresentacionProducto,
)
from apps.catalogo.serializers import (
    CategoriaSerializer,
    FamiliaOlfativaSerializer,
    ProductoSerializer,
    PresentacionSerializer,
)
from apps.usuarios.permissions import EsAdministrador


class CatalogoPublicoMixin:
    """
    Las lecturas del catálogo no dependen de JWT. Así, una cabecera
    Authorization inválida no bloquea una consulta pública.
    En escritura se conserva la autenticación JWT normal.
    """

    def get_authenticators(self):
        if getattr(self.request, "method", None) in (
            "GET",
            "HEAD",
            "OPTIONS",
        ):
            return []

        return super().get_authenticators()

    def _aplicar_cache_publica(self, response):
        if self.request.method != "GET":
            return response

        tiene_autorizacion = bool(
            self.request.headers.get("Authorization")
        )

        if tiene_autorizacion:
            response["Cache-Control"] = "no-store"
        else:
            response["Cache-Control"] = (
                "public, max-age=30, stale-while-revalidate=60"
            )

        vary = response.get("Vary", "")
        valores_vary = {
            valor.strip()
            for valor in vary.split(",")
            if valor.strip()
        }
        valores_vary.add("Authorization")
        response["Vary"] = ", ".join(sorted(valores_vary))
        return response

    def list(self, request, *args, **kwargs):
        response = super().list(request, *args, **kwargs)
        return self._aplicar_cache_publica(response)

    def retrieve(self, request, *args, **kwargs):
        response = super().retrieve(request, *args, **kwargs)
        return self._aplicar_cache_publica(response)


class CategoriaListCreateView(
    CatalogoPublicoMixin,
    generics.ListCreateAPIView,
):
    """
    GET  -> Público.
    POST -> Solo administrador.
    """

    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]

        return [IsAuthenticated(), EsAdministrador()]


class CategoriaDetailView(
    CatalogoPublicoMixin,
    generics.RetrieveUpdateDestroyAPIView,
):
    """
    GET    -> Público.
    PUT    -> Solo administrador.
    PATCH  -> Solo administrador.
    DELETE -> Solo administrador.
    """

    queryset = Categoria.objects.all()
    serializer_class = CategoriaSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]

        return [IsAuthenticated(), EsAdministrador()]


class ProductoListCreateView(
    CatalogoPublicoMixin,
    generics.ListCreateAPIView,
):
    """
    GET  -> Catálogo público: productos activos con precio asignado.
    POST -> Solo administrador.
    """

    serializer_class = ProductoSerializer
    filterset_class = ProductoFilter

    def get_queryset(self):
        queryset = Producto.objects.select_related(
            "categoria"
        ).prefetch_related(
            "familias_olfativas"
        )

        if self.request.method == "GET":
            return queryset.filter(
                activo=True,
                precio__isnull=False,
                precio__gt=0,
            ).distinct()

        return queryset

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]

        return [IsAuthenticated(), EsAdministrador()]


class ProductoAdminListView(generics.ListAPIView):
    """
    Listado administrativo de productos.

    A diferencia del catálogo público, incluye productos inactivos y
    productos sin precio para que el panel pueda editarlos y
    reactivarlos. Solo administradores y superusuarios.
    """

    serializer_class = ProductoSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]

    def get_queryset(self):
        return (
            Producto.objects
            .select_related("categoria")
            .prefetch_related("familias_olfativas")
            .order_by("nombre", "id")
        )


class ProductoDetailView(
    CatalogoPublicoMixin,
    generics.RetrieveUpdateDestroyAPIView,
):
    """
    GET    -> Público solo para productos activos con precio asignado.
    PUT    -> Solo administrador.
    PATCH  -> Solo administrador.
    DELETE -> Solo administrador.
    """

    serializer_class = ProductoSerializer

    def get_queryset(self):
        queryset = Producto.objects.select_related(
            "categoria"
        ).prefetch_related(
            "familias_olfativas"
        )

        if self.request.method == "GET":
            return queryset.filter(
                activo=True,
                precio__isnull=False,
                precio__gt=0,
            )

        return queryset

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]

        return [IsAuthenticated(), EsAdministrador()]


class PresentacionListCreateView(generics.ListCreateAPIView):
    """
    Configuración interna de porcentajes de recarga.

    No es parte del catálogo público: expone porcentajes internos y
    por eso todas las operaciones requieren administrador.
    """

    serializer_class = PresentacionSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]
    filterset_fields = ["producto"]

    def get_queryset(self):
        return PresentacionProducto.objects.select_related(
            "producto"
        )


class PresentacionDetailView(generics.RetrieveUpdateDestroyAPIView):
    """
    Configuración interna de porcentajes de recarga.

    Solo administrador. No se expone en el catálogo público.
    """

    serializer_class = PresentacionSerializer
    permission_classes = [IsAuthenticated, EsAdministrador]

    def get_queryset(self):
        return PresentacionProducto.objects.select_related(
            "producto"
        )


class FamiliaOlfativaListCreateView(
    CatalogoPublicoMixin,
    generics.ListCreateAPIView,
):
    """
    GET  -> Público.
    POST -> Solo administrador.
    """

    queryset = FamiliaOlfativa.objects.all()
    serializer_class = FamiliaOlfativaSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]

        return [IsAuthenticated(), EsAdministrador()]


class FamiliaOlfativaDetailView(
    CatalogoPublicoMixin,
    generics.RetrieveUpdateDestroyAPIView,
):
    """
    GET    -> Público.
    PUT    -> Solo administrador.
    PATCH  -> Solo administrador.
    DELETE -> Solo administrador, solo si no tiene productos.
    """

    queryset = FamiliaOlfativa.objects.all()
    serializer_class = FamiliaOlfativaSerializer

    def get_permissions(self):
        if self.request.method == "GET":
            return [AllowAny()]

        return [IsAuthenticated(), EsAdministrador()]

    def perform_destroy(self, instance):
        if instance.productos.exists():
            raise ConflictoError(
                "No se puede eliminar la familia olfativa porque tiene "
                "productos asociados. Reasigna esos productos a otra "
                "familia o quítalos de esta familia antes de eliminarla."
            )

        instance.delete()
