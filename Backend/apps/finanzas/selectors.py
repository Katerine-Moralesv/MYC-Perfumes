from apps.finanzas.models import Compra, Venta, Cliente, Proveedor


def listar_ventas(
    cliente_id=None,
    estado_pago=None,
    fecha_inicio=None,
    fecha_fin=None,
    registrado_por_id=None,
    con_pendientes_abastecimiento=False,
):
    qs = (
        Venta.objects
        .select_related("cliente", "pedido_origen")
        .prefetch_related(
            "detalles__presentacion__producto",
            "abonos",
            "devoluciones",
        )
    )
    if cliente_id:
        qs = qs.filter(cliente_id=cliente_id)
    if estado_pago:
        qs = qs.filter(estado_pago=estado_pago)
    if fecha_inicio:
        qs = qs.filter(fecha__gte=fecha_inicio)
    if fecha_fin:
        qs = qs.filter(fecha__lte=fecha_fin)
    if registrado_por_id:
        qs = qs.filter(registrado_por_id=registrado_por_id)
    if con_pendientes_abastecimiento:
        qs = qs.filter(
            detalles__cantidad_pendiente__gt=0
        ).distinct()
    return qs


def listar_compras(proveedor_id=None, fecha_inicio=None, fecha_fin=None):
    qs = (
        Compra.objects
        .select_related("proveedor")
        .prefetch_related(
            "detalles__presentacion__producto",
            "detalles__asignaciones__detalle_pedido__producto",
            "recepciones__detalles__detalle_compra__presentacion__producto",
        )
    )
    if proveedor_id:
        qs = qs.filter(proveedor_id=proveedor_id)
    if fecha_inicio:
        qs = qs.filter(fecha__gte=fecha_inicio)
    if fecha_fin:
        qs = qs.filter(fecha__lte=fecha_fin)
    return qs


def obtener_venta_detalle(venta_id):
    return (
        Venta.objects.select_related("cliente", "pedido_origen")
        .prefetch_related(
            "detalles__presentacion__producto",
            "abonos",
            "devoluciones",
        )
        .filter(pk=venta_id)
        .first()
    )


def listar_clientes():
    return Cliente.objects.all()


def listar_proveedores(solo_activos=True):
    qs = Proveedor.objects.all()
    return qs.filter(activo=True) if solo_activos else qs
