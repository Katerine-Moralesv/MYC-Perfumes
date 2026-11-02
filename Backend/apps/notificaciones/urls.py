from django.urls import path

from apps.notificaciones.views import (
    DesactivarDispositivoView,
    RegistrarDispositivoView,
)


urlpatterns = [
    path(
        "dispositivos/",
        RegistrarDispositivoView.as_view(),
        name="notificacion-dispositivo-registrar",
    ),
    path(
        "dispositivos/desactivar/",
        DesactivarDispositivoView.as_view(),
        name="notificacion-dispositivo-desactivar",
    ),
]
