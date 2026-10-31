
from decimal import Decimal

from django.db import transaction
from rest_framework import serializers

from apps.catalogo.models import (
    Categoria,
    FamiliaOlfativa,
    Producto,
    PresentacionProducto,
)
from apps.catalogo.services import crear_presentaciones_predeterminadas


class CategoriaSerializer(serializers.ModelSerializer):
    class Meta:
        model = Categoria
        fields = ["id", "nombre"]
        read_only_fields = ["id"]

    def validate_nombre(self, value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "El nombre de la categoría no puede estar vacío."
            )

        queryset = Categoria.objects.filter(nombre__iexact=value)

        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.exists():
            raise serializers.ValidationError(
                "Ya existe una categoría con este nombre."
            )

        return value


class FamiliaOlfativaSerializer(serializers.ModelSerializer):
    class Meta:
        model = FamiliaOlfativa
        fields = ["id", "nombre"]
        read_only_fields = ["id"]

    def validate_nombre(self, value):
        value = " ".join(value.split())

        if not value:
            raise serializers.ValidationError(
                "El nombre de la familia olfativa no puede estar vacío."
            )

        queryset = FamiliaOlfativa.objects.filter(
            nombre__iexact=value
        )

        if self.instance:
            queryset = queryset.exclude(pk=self.instance.pk)

        if queryset.exists():
            raise serializers.ValidationError(
                "Ya existe una familia olfativa con este nombre."
            )

        return value


class ProductoSerializer(serializers.ModelSerializer):
    categoria_nombre = serializers.CharField(
        source="categoria.nombre",
        read_only=True,
    )

    familias_olfativas = serializers.PrimaryKeyRelatedField(
        many=True,
        queryset=FamiliaOlfativa.objects.all(),
        required=False,
    )

    familias_olfativas_nombres = serializers.SerializerMethodField()

    class Meta:
        model = Producto
        fields = [
            "id",
            "categoria",
            "categoria_nombre",
            "familias_olfativas",
            "familias_olfativas_nombres",
            "nombre",
            "descripcion",
            "foto",
            "precio",
            "contenido_ml",
            "dias_entrega",
            "activo",
        ]
        read_only_fields = [
            "id",
            "categoria_nombre",
            "familias_olfativas_nombres",
        ]

    def validate_nombre(self, value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "El nombre del producto no puede estar vacío."
            )

        return value

    def validate_descripcion(self, value):
        return value.strip()

    def validate_precio(self, value):
        if value is None:
            raise serializers.ValidationError(
                "Debes establecer el precio del producto."
            )

        if value <= Decimal("0"):
            raise serializers.ValidationError(
                "El precio debe ser mayor que cero."
            )

        return value

    def validate_contenido_ml(self, value):
        if value is None:
            return value

        if not isinstance(value, int) or value <= 0:
            raise serializers.ValidationError(
                "El contenido en mililitros debe ser un número entero "
                "mayor que cero."
            )

        return value

    def validate_dias_entrega(self, value):
        if value < 1:
            raise serializers.ValidationError(
                "Los días de entrega deben ser como mínimo 1."
            )

        return value

    def validate(self, attrs):
        # Impide crear productos sin precio.
        if self.instance is None and attrs.get("precio") is None:
            raise serializers.ValidationError({
                "precio": "Debes establecer el precio del producto."
            })

        # En actualizaciones parciales se conserva el precio existente.
        precio = attrs.get(
            "precio",
            self.instance.precio if self.instance else None,
        )

        if precio is None:
            raise serializers.ValidationError({
                "precio": "El producto debe tener un precio asignado."
            })

        return attrs

    def get_familias_olfativas_nombres(self, obj):
        return sorted(
            familia.nombre
            for familia in obj.familias_olfativas.all()
        )

    @transaction.atomic
    def create(self, validated_data):
        producto = super().create(validated_data)
        crear_presentaciones_predeterminadas(producto)
        return producto


class PresentacionSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(
        source="producto.nombre",
        read_only=True,
    )

    class Meta:
        model = PresentacionProducto
        fields = [
            "id",
            "producto",
            "producto_nombre",
            "porcentaje",
            "es_personalizada",
            "activo",
        ]
        read_only_fields = [
            "id",
            "producto_nombre",
        ]

    def validate_porcentaje(self, value):
        porcentajes_validos = {
            porcentaje
            for porcentaje, _ in PresentacionProducto.PORCENTAJES
        }

        if value not in porcentajes_validos:
            raise serializers.ValidationError(
                "El porcentaje debe ser 40%, 60%, 70% u 80%."
            )

        return value

    def validate(self, attrs):
        producto = attrs.get(
            "producto",
            self.instance.producto if self.instance else None,
        )

        porcentaje = attrs.get(
            "porcentaje",
            self.instance.porcentaje if self.instance else None,
        )

        if producto is not None and not producto.activo:
            raise serializers.ValidationError({
                "producto": (
                    "No se puede crear o modificar una presentación "
                    "para un producto inactivo."
                )
            })

        if producto is not None and porcentaje is not None:
            queryset = PresentacionProducto.objects.filter(
                producto=producto,
                porcentaje=porcentaje,
            )

            if self.instance:
                queryset = queryset.exclude(pk=self.instance.pk)

            if queryset.exists():
                raise serializers.ValidationError({
                    "porcentaje": (
                        "Este producto ya tiene una presentación "
                        f"del {porcentaje}%."
                    )
                })

        return attrs
