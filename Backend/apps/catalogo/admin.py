from django.contrib import admin
from apps.catalogo.models import (
    Categoria,
    FamiliaOlfativa,
    Producto,
    PresentacionProducto,
)

admin.site.register(Categoria)
admin.site.register(FamiliaOlfativa)


@admin.register(PresentacionProducto)
class PresentacionProductoAdmin(admin.ModelAdmin):
    list_display = [
        "producto",
        "porcentaje",
        "es_personalizada",
        "activo",
    ]
    list_filter = [
        "es_personalizada",
        "activo",
    ]


class PresentacionInline(admin.TabularInline):
    model = PresentacionProducto
    extra = 3


@admin.register(Producto)
class ProductoAdmin(admin.ModelAdmin):
    list_display = [
        "nombre",
        "categoria",
        "contenido_ml",
        "precio",
        "activo",
    ]
    list_filter = [
        "categoria",
        "familias_olfativas",
        "activo",
    ]
    filter_horizontal = [
        "familias_olfativas",
    ]
    inlines = [PresentacionInline]

    