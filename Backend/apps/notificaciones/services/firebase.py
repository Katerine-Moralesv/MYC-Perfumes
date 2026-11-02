import base64
import json
import logging

from django.conf import settings

import firebase_admin
from firebase_admin import credentials, messaging


logger = logging.getLogger(__name__)

_app_firebase = None


def cargar_credenciales_firebase():
    """
    Lee la cuenta de servicio desde FIREBASE_CREDENTIALS_BASE64.

    El JSON nunca se guarda en el repositorio ni se expone en logs.
    """

    contenido = getattr(
        settings,
        "FIREBASE_CREDENTIALS_BASE64",
        "",
    ) or ""

    if not contenido.strip():
        return None

    try:
        # Se toleran saltos de línea o espacios al pegar la variable
        # en paneles como Render.
        compacto = "".join(contenido.split())
        decodificado = base64.b64decode(
            compacto,
            validate=True,
        ).decode("utf-8")
        datos = json.loads(decodificado)
    except Exception:
        logger.error(
            "FIREBASE_CREDENTIALS_BASE64 no contiene un JSON válido."
        )
        return None

    if not isinstance(datos, dict) or not datos.get("project_id"):
        logger.error(
            "Las credenciales de Firebase no incluyen project_id."
        )
        return None

    try:
        return credentials.Certificate(datos)
    except Exception:
        logger.exception(
            "No se pudieron construir las credenciales de Firebase."
        )
        return None


def obtener_app_firebase():
    """
    Inicializa Firebase Admin una única vez.

    Devuelve None si no hay credenciales o si la inicialización falla.
    La aplicación debe seguir funcionando aunque Firebase no esté
    disponible.
    """

    global _app_firebase

    if _app_firebase is not None:
        return _app_firebase

    try:
        _app_firebase = firebase_admin.get_app()
        return _app_firebase
    except ValueError:
        pass

    credencial = cargar_credenciales_firebase()

    if credencial is None:
        return None

    try:
        _app_firebase = firebase_admin.initialize_app(credencial)
    except ValueError:
        _app_firebase = firebase_admin.get_app()
    except Exception:
        logger.exception(
            "No se pudo inicializar Firebase Admin."
        )
        return None

    return _app_firebase
