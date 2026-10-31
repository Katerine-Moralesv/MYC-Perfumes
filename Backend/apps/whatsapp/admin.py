from django.contrib import admin

from apps.whatsapp.models import NotificacionWhatsApp


@admin.register(NotificacionWhatsApp)
class NotificacionWhatsAppAdmin(admin.ModelAdmin):
    list_display = (
        "pedido",
        "estado",
        "intentos",
        "creado_en",
        "enviado_en",
    )
    list_filter = ("estado",)
    search_fields = ("pedido__id", "proveedor_mensaje_id")
    readonly_fields = (
        "pedido",
        "estado",
        "intentos",
        "proveedor_mensaje_id",
        "codigo_error",
        "ultimo_error",
        "creado_en",
        "actualizado_en",
        "enviado_en",
    )
