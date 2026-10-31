from apps.catalogo.models import PresentacionProducto


PORCENTAJES_PREDETERMINADOS = (40, 60, 70, 80)


def crear_presentaciones_predeterminadas(producto):
    """
    Crea únicamente las presentaciones internas faltantes.

    Es idempotente y no modifica presentaciones existentes, sus
    estados ni sus costos. No crea compras ni define costos.
    """

    existentes = set(
        PresentacionProducto.objects
        .filter(producto=producto)
        .values_list("porcentaje", flat=True)
    )

    nuevas = [
        PresentacionProducto(
            producto=producto,
            porcentaje=porcentaje,
        )
        for porcentaje in PORCENTAJES_PREDETERMINADOS
        if porcentaje not in existentes
    ]

    if nuevas:
        PresentacionProducto.objects.bulk_create(
            nuevas,
            ignore_conflicts=True,
        )

    return nuevas
