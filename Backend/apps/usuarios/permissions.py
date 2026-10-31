from rest_framework.permissions import BasePermission


def es_administrador(user):
    """
    Un superusuario de Django conserva acceso administrativo aunque
    su campo rol sea vendedor. Un usuario normal solo es administrador
    si su rol real es admin.
    """
    if not user or not user.is_authenticated:
        return False

    return bool(
        user.is_superuser or
        getattr(user, "rol", None) == "admin"
    )


class EsAdministrador(BasePermission):
    """
    Restringe una vista a usuarios con rol admin o superusuarios.
    Un vendedor autenticado recibe 403 (sí inició sesión, pero no
    tiene permiso para esta acción puntual), no 401.
    """
    message = "Solo un administrador puede realizar esta acción."

    def has_permission(self, request, view):
        return es_administrador(request.user)

class EsAdministradorOConsultaPublica(BasePermission):
    """
    Permite consultar información del catálogo públicamente.

    Lectura:
        GET -> Público

    Escritura:
        POST, PUT, PATCH, DELETE -> Solo Admin
    """

    message = "Solo un administrador puede modificar esta información."

    def has_permission(self, request, view):
        # Cualquier persona puede consultar el catálogo
        if request.method in ("GET", "HEAD", "OPTIONS"):
            return True

        # Las modificaciones requieren usuario autenticado
        if not request.user or not request.user.is_authenticated:
            return False

        # Solo Admin o superusuario puede modificar
        return es_administrador(request.user)