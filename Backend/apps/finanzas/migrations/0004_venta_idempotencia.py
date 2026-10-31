from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("finanzas", "0003_abono_libro_pagos"),
    ]

    operations = [
        migrations.AddField(
            model_name="venta",
            name="clave_idempotencia",
            field=models.CharField(
                blank=True,
                editable=False,
                max_length=64,
                null=True,
                unique=True,
            ),
        ),
        migrations.AddField(
            model_name="venta",
            name="hash_solicitud",
            field=models.CharField(
                blank=True,
                default="",
                editable=False,
                max_length=64,
            ),
        ),
    ]
