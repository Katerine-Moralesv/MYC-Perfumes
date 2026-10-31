"""
Acceso a datos usado internamente por los services.
Distinto de selectors.py: esto no se llama directamente desde
las vistas.
"""

from apps.catalogo.models import PresentacionProducto
from apps.core.utils import normalizar_telefono
from apps.finanzas.models import (
    DetalleCompra,
    Venta,
    Cliente,
    Proveedor,
)


def costo_unitario_vigente(presentacion_id):
    """
    Política actual:
    costo de la compra más reciente de esa presentación.
    """

    ultimo = (
        DetalleCompra.objects
        .filter(
            presentacion_id=presentacion_id
        )
        .order_by(
            "-compra__fecha",
            "-id",
        )
        .first()
    )

    return ultimo.costo_unitario if ultimo else None


def obtener_cliente_o_none(cliente_id):
    return (
        Cliente.objects
        .filter(pk=cliente_id)
        .first()
    )


def obtener_o_crear_cliente_por_telefono(
    telefono,
    nombre,
):
    """
    Reutiliza un cliente por teléfono normalizado.

    Se toleran registros históricos guardados sin el indicativo +57:
    se compara el teléfono normalizado de los candidatos antes de crear.
    Si no existe, se crea uno nuevo. No se actualizan nombre ni teléfono
    de un cliente existente.
    """

    normalizado = normalizar_telefono(telefono)

    if not normalizado:
        raise ValueError("El teléfono no es válido.")

    cliente = (
        Cliente.objects
        .filter(telefono=normalizado)
        .first()
    )

    if cliente is not None:
        return cliente

    for candidato in (
        Cliente.objects
        .exclude(telefono="")
        .only("id", "telefono")
        .iterator()
    ):
        if normalizar_telefono(candidato.telefono) == normalizado:
            return candidato

    return Cliente.objects.create(
        nombre=nombre,
        telefono=normalizado,
    )


def obtener_proveedor_activo_o_none(proveedor_id):
    return (
        Proveedor.objects
        .filter(
            pk=proveedor_id,
            activo=True,
        )
        .first()
    )


def obtener_presentacion_activa(presentacion_id):
    """
    Solo permite utilizar presentaciones activas
    pertenecientes a productos activos.
    """

    return (
        PresentacionProducto.objects
        .select_related("producto")
        .filter(
            pk=presentacion_id,
            activo=True,
            producto__activo=True,
        )
        .first()
    )


def obtener_venta_para_actualizar(venta_id):
    """
    Bloquea la venta durante la transacción.
    Evita que dos abonos simultáneos corrompan el saldo.
    """

    return (
        Venta.objects
        .select_for_update()
        .filter(pk=venta_id)
        .first()
    )