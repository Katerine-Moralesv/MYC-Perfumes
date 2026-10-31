# El porcentaje de recarga es una elección del pedido, no una
# presentación obligatoria. El detalle guarda producto directo y la
# presentación pasa a ser opcional; se conserva para pedidos antiguos
# y para la resolución de costos cuando exista configuración.

import django.db.models.deletion
from django.db import migrations, models


def backfill_producto(apps, schema_editor):
    DetallePedido = apps.get_model("pedidos", "DetallePedido")

    for detalle in DetallePedido.objects.select_related(
        "presentacion"
    ).iterator():
        if (
            detalle.producto_id is None
            and detalle.presentacion_id is not None
        ):
            detalle.producto_id = detalle.presentacion.producto_id
            detalle.save(update_fields=["producto_id"])


class Migration(migrations.Migration):

    dependencies = [
        ("catalogo", "0004_familias_olfativas_y_recarga"),
        ("pedidos", "0004_recarga_y_porcentaje_final"),
    ]

    operations = [
        migrations.AddField(
            model_name="detallepedido",
            name="producto",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="detalles_pedido",
                to="catalogo.producto",
            ),
        ),
        migrations.AlterField(
            model_name="detallepedido",
            name="presentacion",
            field=models.ForeignKey(
                blank=True,
                null=True,
                on_delete=django.db.models.deletion.PROTECT,
                related_name="+",
                to="catalogo.presentacionproducto",
            ),
        ),
        migrations.RunPython(
            backfill_producto,
            migrations.RunPython.noop,
        ),
    ]
