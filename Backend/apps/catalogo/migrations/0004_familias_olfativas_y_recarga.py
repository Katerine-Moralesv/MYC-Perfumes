# Familias olfativas como clasificación independiente y adaptación
# de PresentacionProducto como configuración interna de recarga.
#
# La migración solo agrega estructuras y datos deterministas:
# - crea las familias olfativas como catálogo vacío;
# - garantiza las categorías iniciales de público objetivo;
# - garantiza una configuración del 40% para cada producto existente.
# No reasigna categorías ambiguas ni crea familias automáticamente.

from django.db import migrations, models


def seed_publico_y_recarga(apps, schema_editor):
    Categoria = apps.get_model("catalogo", "Categoria")
    Producto = apps.get_model("catalogo", "Producto")
    PresentacionProducto = apps.get_model(
        "catalogo",
        "PresentacionProducto",
    )

    for nombre in ("Mujer", "Hombre", "Unisex"):
        if not Categoria.objects.filter(
            nombre__iexact=nombre
        ).exists():
            Categoria.objects.create(nombre=nombre)

    for producto in Producto.objects.all().iterator():
        PresentacionProducto.objects.get_or_create(
            producto_id=producto.id,
            porcentaje=40,
            defaults={
                "activo": True,
                "es_personalizada": False,
            },
        )


class Migration(migrations.Migration):

    dependencies = [
        ("catalogo", "0003_presentacionproducto_es_personalizada"),
    ]

    operations = [
        migrations.CreateModel(
            name="FamiliaOlfativa",
            fields=[
                (
                    "id",
                    models.BigAutoField(
                        auto_created=True,
                        primary_key=True,
                        serialize=False,
                        verbose_name="ID",
                    ),
                ),
                (
                    "nombre",
                    models.CharField(max_length=100, unique=True),
                ),
            ],
            options={
                "verbose_name_plural": "Familias olfativas",
                "ordering": ["nombre"],
            },
        ),
        migrations.AddField(
            model_name="producto",
            name="familias_olfativas",
            field=models.ManyToManyField(
                blank=True,
                related_name="productos",
                to="catalogo.familiaolfativa",
            ),
        ),
        migrations.AlterField(
            model_name="presentacionproducto",
            name="porcentaje",
            field=models.PositiveSmallIntegerField(
                choices=[
                    (40, "40%"),
                    (60, "60%"),
                    (70, "70%"),
                    (80, "80%"),
                ]
            ),
        ),
        migrations.RunPython(
            seed_publico_y_recarga,
            migrations.RunPython.noop,
        ),
    ]
