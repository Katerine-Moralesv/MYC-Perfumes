# Garantiza las categorías comerciales predefinidas de MYC Perfumes.
#
# La migración es idempotente y no destructiva:
# - reutiliza cualquier categoría existente con el mismo nombre
#   sin distinguir mayúsculas/minúsculas;
# - crea únicamente las categorías faltantes;
# - no modifica productos ni otras relaciones.
#
# Se agrega una migración nueva (en lugar de editar 0004) porque esa
# migración ya está registrada en bases de datos existentes.

from django.db import migrations


CATEGORIAS_PREDEFINIDAS = ("Mujer", "Hombre", "Unisex")


def crear_categorias_predefinidas(apps, schema_editor):
    Categoria = apps.get_model("catalogo", "Categoria")

    for nombre in CATEGORIAS_PREDEFINIDAS:
        existe = Categoria.objects.filter(
            nombre__iexact=nombre
        ).exists()

        if not existe:
            Categoria.objects.create(nombre=nombre)


class Migration(migrations.Migration):

    dependencies = [
        ("catalogo", "0005_producto_contenido_ml"),
    ]

    operations = [
        migrations.RunPython(
            crear_categorias_predefinidas,
            migrations.RunPython.noop,
        ),
    ]
