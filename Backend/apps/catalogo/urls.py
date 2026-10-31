from django.urls import path
from apps.catalogo.views import (
    CategoriaListCreateView, CategoriaDetailView,
    FamiliaOlfativaListCreateView, FamiliaOlfativaDetailView,
    ProductoListCreateView, ProductoAdminListView, ProductoDetailView,
    PresentacionListCreateView, PresentacionDetailView,
)

urlpatterns = [
    path("categorias/", CategoriaListCreateView.as_view(), name="categoria-list-create"),
    path("categorias/<int:pk>/", CategoriaDetailView.as_view(), name="categoria-detail"),
    path("productos/", ProductoListCreateView.as_view(), name="producto-list-create"),
    path("productos/admin/", ProductoAdminListView.as_view(), name="producto-admin-list"),
    path("productos/<int:pk>/", ProductoDetailView.as_view(), name="producto-detail"),
    path("presentaciones/", PresentacionListCreateView.as_view(), name="presentacion-list-create"),
    path("presentaciones/<int:pk>/", PresentacionDetailView.as_view(), name="presentacion-detail"),
    path("familias-olfativas/", FamiliaOlfativaListCreateView.as_view(), name="familia-olfativa-list-create"),
    path("familias-olfativas/<int:pk>/", FamiliaOlfativaDetailView.as_view(), name="familia-olfativa-detail"),
]