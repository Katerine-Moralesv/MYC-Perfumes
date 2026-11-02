import logging

from django.db.models import Q

from firebase_admin import exceptions, messaging

from apps.notificaciones.models import DispositivoFCM
from apps.notificaciones.services.firebase import obtener_app_firebase
from apps.usuarios.models import Usuario


logger = logging.getLogger(__name__)


def construir_mensaje_pedido(pedido):
    """
    Construye un mensaje data-only para que el Service Worker controle
    la notificación y el evento notificationclick.
    """

    cliente = getattr(pedido, "cliente", None)
    nombre_cliente = getattr(cliente, "nombre", "") or "Una clienta"
    total = getattr(pedido, "total", None)

    cuerpo = f"{nombre_cliente} registró un pedido."
    cuerpo += f" Total: ${total}." if total is not None else ""

    return {
        "tipo": "pedido_nuevo",
        "pedido_id": str(pedido.pk),
        "titulo": f"Nuevo pedido #{pedido.pk}",
        "cuerpo": cuerpo,
        "url": f"/?pedido={pedido.pk}",
    }


def obtener_tokens_administradores():
    """
    Devuelve los tokens activos de usuarios administradores activos.
    """

    return list(
        DispositivoFCM.objects
        .filter(activo=True, usuario__is_active=True)
        .filter(
            Q(usuario__rol=Usuario.Rol.ADMIN)
            | Q(usuario__is_superuser=True)
        )
        .values_list("token", flat=True)
        .distinct()
    )


def _token_invalido(excepcion):
    return isinstance(
        excepcion,
        (
            messaging.UnregisteredError,
            messaging.SenderIdMismatchError,
            exceptions.InvalidArgumentError,
        ),
    )


def enviar_notificacion_pedido(pedido):
    """
    Envía la notificación a todos los dispositivos activos de los
    administradores. Nunca lanza excepciones hacia la creación del
    pedido.
    """

    try:
        tokens = obtener_tokens_administradores()
    except Exception:
        logger.exception(
            "No se pudieron consultar los dispositivos FCM."
        )
        return 0

    if not tokens:
        return 0

    app_firebase = obtener_app_firebase()

    if app_firebase is None:
        logger.warning(
            "Firebase Admin no está configurado; "
            "no se envió la notificación del pedido %s.",
            getattr(pedido, "pk", None),
        )
        return 0

    datos = construir_mensaje_pedido(pedido)
    webpush = messaging.WebpushConfig(
        headers={"Urgency": "high"},
    )
    mensajes = [
        messaging.Message(
            data=datos,
            token=token,
            webpush=webpush,
        )
        for token in tokens
    ]

    try:
        respuesta = messaging.send_each(
            mensajes,
            app=app_firebase,
        )
    except Exception:
        logger.exception(
            "Falló el envío de la notificación del pedido %s.",
            getattr(pedido, "pk", None),
        )
        return 0

    tokens_invalidos = []

    for token, resultado in zip(tokens, respuesta.responses):
        if resultado.success:
            continue

        excepcion = getattr(resultado, "exception", None)

        if _token_invalido(excepcion):
            tokens_invalidos.append(token)
        else:
            logger.warning(
                "No se pudo enviar la notificación a un dispositivo: %s",
                type(excepcion).__name__,
            )

    if tokens_invalidos:
        DispositivoFCM.objects.filter(
            token__in=tokens_invalidos,
        ).update(activo=False)

    return getattr(respuesta, "success_count", 0)
