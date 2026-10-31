from django.db import migrations, models


class Migration(migrations.Migration):

    dependencies = [
        ("finanzas", "0002_initial"),
    ]

    operations = [
        migrations.AddField(
            model_name="abono",
            name="creado_en",
            field=models.DateTimeField(auto_now_add=True, null=True),
        ),
        migrations.AddField(
            model_name="abono",
            name="tipo",
            field=models.CharField(
                blank=True,
                choices=[
                    ("inicial", "Inicial"),
                    ("posterior", "Posterior"),
                ],
                max_length=10,
                null=True,
            ),
        ),
        migrations.AddField(
            model_name="abono",
            name="clave_idempotencia",
            field=models.CharField(
                blank=True,
                editable=False,
                max_length=64,
                null=True,
                unique=True,
            ),
        ),
        migrations.AddIndex(
            model_name="abono",
            index=models.Index(
                fields=["fecha"],
                name="finanzas_abono_fecha_idx",
            ),
        ),
        migrations.AddConstraint(
            model_name="abono",
            constraint=models.UniqueConstraint(
                condition=models.Q(("tipo", "inicial")),
                fields=("venta",),
                name="uq_abono_inicial_por_venta",
            ),
        ),
    ]
