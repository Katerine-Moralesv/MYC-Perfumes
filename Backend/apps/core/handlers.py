from rest_framework.views import exception_handler as drf_exception_handler
from rest_framework.response import Response
from rest_framework import status

from apps.core.exceptions import (
    ConflictoError,
    ReglaNegocioError,
    RecursoNoEncontradoError,
)


def exception_handler(exc, context):
    
    if isinstance(exc, ReglaNegocioError):
        return Response({"detail": exc.mensaje}, status=status.HTTP_400_BAD_REQUEST)

    if isinstance(exc, RecursoNoEncontradoError):
        return Response({"detail": exc.mensaje}, status=status.HTTP_404_NOT_FOUND)

    if isinstance(exc, ConflictoError):
        return Response({"detail": exc.mensaje}, status=status.HTTP_409_CONFLICT)

    # Cualquier otro error (ValidationError de DRF, PermissionDenied, etc.)
    # sigue el flujo normal de DRF.
    return drf_exception_handler(exc, context)
