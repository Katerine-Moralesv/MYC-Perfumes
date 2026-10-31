from apps.pedidos.models import HistorialEstadoPedido


def registrar_transicion(
    *,
    pedido,
    estado_anterior,
    estado_nuevo,
    usuario=None,
    motivo="",
):
    if (
        estado_anterior == estado_nuevo
        and not motivo
    ):
        return None

    return HistorialEstadoPedido.objects.create(
        pedido=pedido,
        estado_anterior=estado_anterior or "",
        estado_nuevo=estado_nuevo,
        motivo=str(motivo or "").strip(),
        registrado_por=usuario,
    )
