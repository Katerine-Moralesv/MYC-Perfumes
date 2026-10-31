from django.contrib import admin
from django.contrib.auth.admin import UserAdmin
from apps.usuarios.models import Usuario


@admin.register(Usuario)
class UsuarioAdmin(UserAdmin):
    """
    Hereda de UserAdmin (no admin.ModelAdmin simple) para conservar
    el formulario correcto de contraseña hasheada. Se agrega 'rol'
    a los campos visibles.
    """
    fieldsets = UserAdmin.fieldsets + (
        ("Rol en el negocio", {"fields": ("rol",)}),
    )
    list_display = ["username", "email", "rol", "is_staff"]