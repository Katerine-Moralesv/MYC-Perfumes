from django.contrib import admin

from apps.notificaciones.models import DispositivoFCM


@admin.register(DispositivoFCM)
class DispositivoFCMAdmin(admin.ModelAdmin):
    list_display = (
        "id",
        "usuario",
        "plataforma",
        "activo",
        "actualizado_en",
    )
    list_filter = ("plataforma", "activo")
    search_fields = (
        "usuario__username",
        "usuario__email",
    )
    readonly_fields = (
        "creado_en",
        "actualizado_en",
    )
