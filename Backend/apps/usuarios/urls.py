from django.urls import path

from apps.usuarios.views import (
    PerfilView,
    UsuarioAdminListCreateView,
    UsuarioAdminDetailView,
    SolicitarRecuperacionView,
    VerificarCodigoView,
    RestablecerPasswordView,
)


urlpatterns = [
    path(
        "perfil/",
        PerfilView.as_view(),
        name="usuario-perfil",
    ),

    path(
        "usuarios/",
        UsuarioAdminListCreateView.as_view(),
        name="usuarios-list-create",
    ),

    path(
        "usuarios/<int:pk>/",
        UsuarioAdminDetailView.as_view(),
        name="usuario-detail",
    ),

    # Recuperación de contraseña
    path(
        "password/solicitar/",
        SolicitarRecuperacionView.as_view(),
        name="password-solicitar",
    ),

    path(
        "password/verificar/",
        VerificarCodigoView.as_view(),
        name="password-verificar",
    ),

    path(
        "password/restablecer/",
        RestablecerPasswordView.as_view(),
        name="password-restablecer",
    ),
]