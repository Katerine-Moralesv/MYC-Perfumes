
from django.contrib import admin
from django.conf import settings
from django.conf.urls.static import static
from django.urls import include, path
from rest_framework_simplejwt.views import TokenRefreshView
from apps.usuarios.views import LoginView
from django.http import JsonResponse


def api_inicio(request):
    return JsonResponse({
        "mensaje": "API de Perfumes MYC funcionando correctamente",
        "estado": "activo",
        "version": "1.0",
    })


urlpatterns = [

    path("", api_inicio, name="api_inicio"),

    # ========================================================
    # ADMINISTRACIÓN DJANGO
    # ========================================================

    path("admin/", admin.site.urls),

    # ========================================================
    # AUTENTICACIÓN JWT
    # ========================================================

    path(
        "api/v1/auth/login/",
        LoginView.as_view(),
        name="token_obtain_pair",
    ),

    path(
        "api/v1/auth/refresh/",
        TokenRefreshView.as_view(),
        name="token_refresh",
    ),

    # ========================================================
    # APIS
    # ========================================================

    path(
        "api/v1/usuarios/",
        include("apps.usuarios.urls"),
    ),

    path(
        "api/v1/catalogo/",
        include("apps.catalogo.urls"),
    ),

    path(
        "api/v1/finanzas/",
        include("apps.finanzas.urls"),
    ),

    path(
        "api/v1/pedidos/",
        include("apps.pedidos.urls"),
    ),

    path(
        "api/v1/whatsapp/",
        include("apps.whatsapp.urls"),
    ),
]


# =========================================================
# ARCHIVOS MULTIMEDIA EN DESARROLLO
# =========================================================

if settings.DEBUG:
    urlpatterns += static(
        settings.MEDIA_URL,
        document_root=settings.MEDIA_ROOT,
    )
