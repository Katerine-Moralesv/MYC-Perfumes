from django.core.management.base import BaseCommand, CommandError

from apps.pedidos.services.cierre import (
    reconciliar_pedidos_por_comprar,
)
from apps.usuarios.models import Usuario
from apps.usuarios.permissions import es_administrador


class Command(BaseCommand):
    help = (
        "Reserva existencias libres para pedidos confirmados o por "
        "comprar que quedaron desactualizados."
    )

    def add_arguments(self, parser):
        parser.add_argument(
            "--usuario",
            required=True,
            help="Username del administrador que registra la operación.",
        )
        parser.add_argument(
            "--pedido",
            type=int,
            default=None,
            help=(
                "Opcional: reconcilia únicamente el pedido indicado. "
                "Si se omite, procesa todos los pedidos pendientes."
            ),
        )

    def handle(self, *args, **options):
        try:
            usuario = Usuario.objects.get(
                username=options["usuario"],
                is_active=True,
            )
        except Usuario.DoesNotExist:
            raise CommandError("El usuario indicado no existe.")

        if not es_administrador(usuario):
            raise CommandError(
                "El usuario indicado no tiene permisos de administrador."
            )

        pedidos = reconciliar_pedidos_por_comprar(
            usuario=usuario,
            pedido_ids=(
                [options["pedido"]]
                if options["pedido"]
                else None
            ),
        )

        self.stdout.write(
            self.style.SUCCESS(
                f"Pedidos reconciliados: {len(pedidos)}."
            )
        )
