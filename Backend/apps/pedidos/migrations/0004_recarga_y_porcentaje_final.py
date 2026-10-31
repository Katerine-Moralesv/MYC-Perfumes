# El antiguo indicador de personalización pasa a representar la
# decisión de recarga. El porcentaje final se guarda como snapshot
# en el detalle y se rellena desde la presentación interna existente.

from django.db import migrations, models


def backfill_porcentaje(apps, schema_editor):
    DetallePedido = apps.get_model("pedidos", "DetallePedido")

    validos = {40, 60, 70, 80}

    for detalle in DetallePedido.objects.select_related(
        "presentacion"
    ).iterator():
        porcentaje = detalle.presentacion.porcentaje

        if porcentaje in validos:
            detalle.porcentaje_recarga = porcentaje
            detalle.save(update_fields=["porcentaje_recarga"])


class Migration(migrations.Migration):

    dependencies = [
        ("catalogo", "0004_familias_olfativas_y_recarga"),
        ("pedidos", "0003_precios_y_total_pedido"),
    ]

    operations = [
        migrations.RenameField(
            model_name="detallepedido",
            old_name="es_personalizada",
            new_name="recarga_solicitada",
        ),
        migrations.AddField(
            model_name="detallepedido",
            name="porcentaje_recarga",
            field=models.PositiveSmallIntegerField(
                choices=[
                    (40, "40%"),
                    (60, "60%"),
                    (70, "70%"),
                    (80, "80%"),
                ],
                default=40,
            ),
        ),
        migrations.RunPython(
            backfill_porcentaje,
            migrations.RunPython.noop,
        ),
    ]
