from django.contrib import admin

from apps.finanzas.models import (
    Proveedor,
    Cliente,
    Compra,
    DetalleCompra,
    Venta,
    DetalleVenta,
    Abono,
)


class SoloLecturaAdmin(admin.ModelAdmin):
    """
    Los registros financieros se pueden consultar desde Django Admin,
    pero no crear, editar ni eliminar.

    Las operaciones financieras deben pasar por los services,
    donde se aplican las reglas de negocio y las transacciones.
    """

    def has_add_permission(self, request):
        return False

    def has_change_permission(self, request, obj=None):
        return False

    def has_delete_permission(self, request, obj=None):
        return False

    def has_view_permission(self, request, obj=None):
        return True


@admin.register(Proveedor)
class ProveedorAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "nombre",
        "telefono",
        "activo",
    ]

    search_fields = [
        "nombre",
        "telefono",
    ]

    list_filter = [
        "activo",
    ]


@admin.register(Cliente)
class ClienteAdmin(admin.ModelAdmin):
    list_display = [
        "id",
        "nombre",
        "telefono",
    ]

    search_fields = [
        "nombre",
        "telefono",
    ]


@admin.register(Compra)
class CompraAdmin(SoloLecturaAdmin):
    list_display = [
        "id",
        "proveedor",
        "fecha",
        "total",
        "registrado_por",
        "creado_en",
    ]

    list_filter = [
        "fecha",
        "proveedor",
    ]

    search_fields = [
        "proveedor__nombre",
    ]


@admin.register(DetalleCompra)
class DetalleCompraAdmin(SoloLecturaAdmin):
    list_display = [
        "id",
        "compra",
        "presentacion",
        "cantidad",
        "costo_unitario",
    ]

    list_filter = [
        "presentacion__producto",
    ]


@admin.register(Venta)
class VentaAdmin(SoloLecturaAdmin):
    list_display = [
        "id",
        "cliente",
        "fecha",
        "estado_pago",
        "total",
        "saldo",
        "registrado_por",
        "creado_en",
    ]

    list_filter = [
        "estado_pago",
        "fecha",
    ]

    search_fields = [
        "cliente__nombre",
    ]


@admin.register(DetalleVenta)
class DetalleVentaAdmin(SoloLecturaAdmin):
    list_display = [
        "id",
        "venta",
        "presentacion",
        "cantidad",
        "precio_venta",
        "costo_unitario",
    ]

    list_filter = [
        "presentacion__producto",
    ]


@admin.register(Abono)
class AbonoAdmin(SoloLecturaAdmin):
    list_display = [
        "id",
        "venta",
        "monto",
        "fecha",
        "tipo",
        "creado_en",
        "registrado_por",
    ]

    list_filter = [
        "fecha",
        "tipo",
    ]

    search_fields = [
        "venta__cliente__nombre",
    ]