from apps.catalogo.models import PresentacionProducto, Producto


def obtener_producto_activo(producto_id):
    return (
        Producto.objects
        .filter(pk=producto_id, activo=True)
        .first()
    )


def obtener_presentacion_por_producto_porcentaje(
    producto_id,
    porcentaje,
):
    return (
        PresentacionProducto.objects
        .select_related("producto")
        .filter(
            producto_id=producto_id,
            porcentaje=porcentaje,
            activo=True,
            producto__activo=True,
        )
        .first()
    )


def obtener_presentacion_activa(presentacion_id):
    """
    Devuelve únicamente presentaciones activas cuyo producto
    también esté activo.
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