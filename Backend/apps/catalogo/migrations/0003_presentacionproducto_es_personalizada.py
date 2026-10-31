# Generated manually for the personalized-price flow.
# Existing presentations keep es_personalizada=False so current
# catalog behavior remains unchanged until an administrator marks them.

from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ('catalogo', '0002_producto_precio'),
    ]

    operations = [
        migrations.AddField(
            model_name='presentacionproducto',
            name='es_personalizada',
            field=models.BooleanField(default=False),
        ),
    ]
