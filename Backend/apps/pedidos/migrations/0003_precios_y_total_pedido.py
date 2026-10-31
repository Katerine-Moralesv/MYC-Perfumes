# Generated manually for the order price/payment flow.
# This migration was still pending and the business tables were empty
# when it was reviewed, so it intentionally contains only schema changes.
# There is no historical backfill to preserve.

from decimal import Decimal

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('catalogo', '0003_presentacionproducto_es_personalizada'),
        ('finanzas', '0002_initial'),
        ('pedidos', '0002_initial'),
    ]

    operations = [
        migrations.AddField(
            model_name='pedido',
            name='total',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0'),
                max_digits=12,
            ),
        ),
        migrations.AddField(
            model_name='detallepedido',
            name='precio_unitario',
            field=models.DecimalField(
                decimal_places=2,
                default=Decimal('0'),
                max_digits=12,
            ),
        ),
        migrations.AddField(
            model_name='detallepedido',
            name='precio_pendiente',
            field=models.BooleanField(default=False),
        ),
        migrations.AddField(
            model_name='detallepedido',
            name='es_personalizada',
            field=models.BooleanField(default=False),
        ),
    ]
