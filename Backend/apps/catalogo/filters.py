import django_filters

from apps.catalogo.models import Producto


class NumberInFilter(
    django_filters.BaseInFilter,
    django_filters.NumberFilter,
):
    pass


class ProductoFilter(django_filters.FilterSet):
    categoria = django_filters.NumberFilter(
        field_name="categoria_id"
    )
    categoria_nombre = django_filters.CharFilter(
        field_name="categoria__nombre",
        lookup_expr="iexact",
    )
    familias_olfativas = NumberInFilter(
        field_name="familias_olfativas__id",
        lookup_expr="in",
    )

    class Meta:
        model = Producto
        fields = [
            "categoria",
            "categoria_nombre",
            "familias_olfativas",
        ]
