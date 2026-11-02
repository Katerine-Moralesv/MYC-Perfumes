from apps.finanzas.models import Cliente
from apps.pedidos.models import Pedido
from apps.core.utils import normalizar_telefono


def obtener_o_crear_cliente_por_telefono(
    telefono,
    nombre="",
):
    telefono_normalizado = normalizar_telefono(
        telefono
    )

    cliente, _ = Cliente.objects.get_or_create(
        telefono=telefono_normalizado,
        defaults={
            "nombre": nombre or "Cliente"
        },
    )

    return cliente


def obtener_pedido_pendiente(pedido_id):
    """
    Bloquea el pedido dentro de la transacción para impedir
    que dos usuarios lo confirmen/rechacen simultáneamente.
    """

    return (
        Pedido.objects
        .select_for_update()
        .filter(
            pk=pedido_id,
            estado=Pedido.Estado.PENDIENTE,
        )
        .first()
    )