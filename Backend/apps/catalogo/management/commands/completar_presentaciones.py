from django.core.management.base import BaseCommand
from django.db import transaction

from apps.catalogo.models import Producto, PresentacionProducto
from apps.catalogo.services import (
    PORCENTAJES_PREDETERMINADOS,
    crear_presentaciones_predeterminadas,
)


class Command(BaseCommand):
    help = (
        "Crea las presentaciones internas faltantes (40, 60, 70 y 80) "
        "para los productos existentes. Por defecto solo simula."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--apply",
            action="store_true",
            help="Aplica los cambios. Sin esta opción solo muestra el plan.",
        )

    def handle(self, *args, **options):
        aplicar = options["apply"]
        productos = Producto.objects.order_by("id")
        total_faltantes = 0
        productos_afectados = 0

        self.stdout.write(
            "Modo: "
            + ("aplicar" if aplicar else "simulación")
        )

        for producto in productos:
            existentes = set(
                PresentacionProducto.objects
                .filter(producto=producto)
                .values_list("porcentaje", flat=True)
            )
            faltantes = [
                porcentaje
                for porcentaje in PORCENTAJES_PREDETERMINADOS
                if porcentaje not in existentes
            ]

            if not faltantes:
                continue

            productos_afectados += 1
            total_faltantes += len(faltantes)
            self.stdout.write(
                f"Producto #{producto.id} ({producto.nombre}): "
                f"faltan {faltantes}"
            )

            if aplicar:
                with transaction.atomic():
                    crear_presentaciones_predeterminadas(producto)

        if aplicar:
            self.stdout.write(
                self.style.SUCCESS(
                    f"Completados {productos_afectados} productos; "
                    f"se crearon como máximo {total_faltantes} "
                    "presentaciones faltantes."
                )
            )
        else:
            self.stdout.write(
                self.style.WARNING(
                    f"Simulación: {productos_afectados} productos "
                    f"con {total_faltantes} presentaciones faltantes. "
                    "Ejecuta con --apply para crearlas."
                )
            )
