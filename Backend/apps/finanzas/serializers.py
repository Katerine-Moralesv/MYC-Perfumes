from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.finanzas.models import (
    Proveedor,
    Cliente,
    Compra,
    DetalleCompra,
    AsignacionCompraPedido,
    RecepcionCompra,
    DetalleRecepcionCompra,
    Venta,
    DetalleVenta,
    Abono,
    Devolucion,
)


# ============================================================
# CATÁLOGOS
# ============================================================

class ProveedorSerializer(serializers.ModelSerializer):
    class Meta:
        model = Proveedor
        fields = [
            "id",
            "nombre",
            "telefono",
            "notas",
            "activo",
        ]
        read_only_fields = ["id"]

    def validate_nombre(self, value):
        value = value.strip()

        if not value:
            raise serializers.ValidationError(
                "El nombre del proveedor no puede estar vacío."
            )

        return value

    def validate_telefono(self, value):
        return value.strip()

    def validate_notas(self, value):
        return value.strip()


class ClienteSerializer(serializers.ModelSerializer):
    class Meta:
        model = Cliente
        fields = [
            "id",
            "nombre",
            "telefono",
            "notas",
        ]


# ============================================================
# LECTURA
# ============================================================

class AsignacionCompraSerializer(serializers.ModelSerializer):
    pedido = serializers.IntegerField(
        source="detalle_pedido.pedido_id",
        read_only=True,
    )

    producto_nombre = serializers.CharField(
        source="detalle_pedido.producto.nombre",
        read_only=True,
    )

    subtotal = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    class Meta:
        model = AsignacionCompraPedido
        fields = [
            "id",
            "detalle_pedido",
            "pedido",
            "producto_nombre",
            "cantidad",
            "costo_unitario",
            "subtotal",
        ]


class DetalleCompraSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(
        source="presentacion.producto.nombre",
        read_only=True,
    )

    porcentaje = serializers.IntegerField(
        source="presentacion.porcentaje",
        read_only=True,
    )

    subtotal = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    cantidad_pendiente = serializers.IntegerField(
        read_only=True,
    )

    asignaciones = AsignacionCompraSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = DetalleCompra
        fields = [
            "id",
            "presentacion",
            "producto_nombre",
            "porcentaje",
            "cantidad",
            "cantidad_recibida",
            "cantidad_pendiente",
            "costo_unitario",
            "subtotal",
            "asignaciones",
        ]


class DetalleRecepcionCompraSerializer(serializers.ModelSerializer):
    class Meta:
        model = DetalleRecepcionCompra
        fields = [
            "id",
            "detalle_compra",
            "cantidad",
            "costo_unitario",
            "subtotal",
        ]
        read_only_fields = fields


class RecepcionCompraSerializer(serializers.ModelSerializer):
    detalles = DetalleRecepcionCompraSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = RecepcionCompra
        fields = [
            "id",
            "compra",
            "fecha",
            "detalles",
            "registrado_por",
            "creado_en",
        ]
        read_only_fields = fields


class CompraSerializer(serializers.ModelSerializer):
    proveedor_nombre = serializers.CharField(
        source="proveedor.nombre",
        read_only=True,
    )

    detalles = DetalleCompraSerializer(
        many=True,
        read_only=True,
    )

    recepciones = RecepcionCompraSerializer(
        many=True,
        read_only=True,
    )

    class Meta:
        model = Compra
        fields = [
            "id",
            "proveedor",
            "proveedor_nombre",
            "fecha",
            "total",
            "detalles",
            "recepciones",
            "creado_en",
        ]


class DetalleVentaSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.CharField(
        source="presentacion.producto.nombre",
        read_only=True,
    )

    porcentaje = serializers.IntegerField(
        source="presentacion.porcentaje",
        read_only=True,
    )

    subtotal = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    ganancia = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    cantidad_cubierta = serializers.IntegerField(
        read_only=True,
    )

    class Meta:
        model = DetalleVenta
        fields = [
            "id",
            "presentacion",
            "producto_nombre",
            "porcentaje",
            "cantidad",
            "cantidad_cubierta",
            "cantidad_pendiente",
            "precio_venta",
            "costo_unitario",
            "subtotal",
            "ganancia",
        ]


class AbonoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Abono
        fields = [
            "id",
            "venta",
            "pedido",
            "monto",
            "fecha",
            "tipo",
            "metodo_pago",
            "referencia",
            "creado_en",
            "registrado_por",
        ]

        read_only_fields = [
            "id",
            "venta",
            "pedido",
            "monto",
            "fecha",
            "tipo",
            "metodo_pago",
            "referencia",
            "creado_en",
            "registrado_por",
        ]


class DevolucionSerializer(serializers.ModelSerializer):
    class Meta:
        model = Devolucion
        fields = [
            "id",
            "pedido",
            "venta",
            "abono",
            "monto",
            "fecha",
            "metodo_pago",
            "referencia",
            "motivo",
            "creado_en",
            "registrado_por",
        ]
        read_only_fields = fields


class VentaSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(
        source="cliente.nombre",
        read_only=True,
    )
    cliente_telefono = serializers.CharField(
        source="cliente.telefono",
        read_only=True,
    )
    origen = serializers.SerializerMethodField()

    detalles = DetalleVentaSerializer(
        many=True,
        read_only=True,
    )

    abonos = AbonoSerializer(
        many=True,
        read_only=True,
    )

    devoluciones = DevolucionSerializer(
        many=True,
        read_only=True,
    )

    estado_abastecimiento = serializers.CharField(
        read_only=True,
    )
    unidades_pendientes_abastecimiento = serializers.IntegerField(
        read_only=True,
    )
    monto_pagado = serializers.SerializerMethodField()

    class Meta:
        model = Venta
        fields = [
            "id",
            "cliente",
            "cliente_nombre",
            "cliente_telefono",
            "origen",
            "fecha",
            "estado_pago",
            "estado_abastecimiento",
            "unidades_pendientes_abastecimiento",
            "total",
            "saldo",
            "monto_pagado",
            "detalles",
            "abonos",
            "devoluciones",
            "creado_en",
        ]

    def get_origen(self, obj):
        return (
            "pedido"
            if getattr(obj, "pedido_origen", None)
            else "manual"
        )

    def get_monto_pagado(self, obj):
        return format(
            sum(
                (abono.monto for abono in obj.abonos.all()),
                Decimal("0.00"),
            ),
            "f",
        )


# ============================================================
# ENTRADA — COMPRAS
# ============================================================

class AsignacionCompraInputSerializer(serializers.Serializer):
    detalle_pedido_id = serializers.IntegerField(
        min_value=1,
    )

    cantidad = serializers.IntegerField(
        min_value=1,
    )


class LineaCompraInputSerializer(serializers.Serializer):
    presentacion_id = serializers.IntegerField()

    cantidad = serializers.IntegerField(
        min_value=1
    )

    costo_unitario = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
    )

    cantidad_recibida = serializers.IntegerField(
        min_value=0,
        required=False,
        allow_null=True,
    )

    asignaciones = AsignacionCompraInputSerializer(
        many=True,
        required=False,
    )

    def validate(self, attrs):
        cantidad = attrs["cantidad"]
        recibida = attrs.get("cantidad_recibida")

        if recibida is not None and recibida > cantidad:
            raise serializers.ValidationError({
                "cantidad_recibida": (
                    "La cantidad recibida no puede superar la comprada."
                )
            })

        asignaciones = attrs.get("asignaciones") or []
        pares = [
            asignacion["detalle_pedido_id"]
            for asignacion in asignaciones
        ]

        if len(pares) != len(set(pares)):
            raise serializers.ValidationError({
                "asignaciones": (
                    "No se puede repetir una línea de pedido en la "
                    "misma compra."
                )
            })

        total_asignado = sum(
            asignacion["cantidad"]
            for asignacion in asignaciones
        )

        if total_asignado > (recibida if recibida is not None else cantidad):
            raise serializers.ValidationError({
                "asignaciones": (
                    "Las asignaciones superan la cantidad recibida."
                )
            })

        return attrs


class RegistrarCompraInputSerializer(serializers.Serializer):
    proveedor_id = serializers.IntegerField()

    fecha = serializers.DateField()

    lineas = LineaCompraInputSerializer(
        many=True
    )

    def validate_lineas(self, value):
        if not value:
            raise serializers.ValidationError(
                "Debe incluir al menos un producto."
            )

        ids = [
            linea["presentacion_id"]
            for linea in value
        ]

        if len(ids) != len(set(ids)):
            raise serializers.ValidationError(
                "No se puede repetir una presentación dentro de una compra."
            )

        return value


class LineaRecepcionCompraInputSerializer(serializers.Serializer):
    detalle_compra_id = serializers.IntegerField(min_value=1)
    cantidad = serializers.IntegerField(min_value=1)
    asignaciones = AsignacionCompraInputSerializer(
        many=True,
        required=False,
    )

    def validate(self, attrs):
        asignaciones = attrs.get("asignaciones") or []
        total = sum(
            asignacion["cantidad"]
            for asignacion in asignaciones
        )

        if total > attrs["cantidad"]:
            raise serializers.ValidationError({
                "asignaciones": (
                    "Las asignaciones superan la cantidad recibida."
                )
            })

        ids = [
            asignacion["detalle_pedido_id"]
            for asignacion in asignaciones
        ]

        if len(ids) != len(set(ids)):
            raise serializers.ValidationError({
                "asignaciones": (
                    "No se puede repetir una línea de pedido en la "
                    "misma recepción."
                )
            })

        return attrs


class RegistrarRecepcionInputSerializer(serializers.Serializer):
    fecha = serializers.DateField()
    lineas = LineaRecepcionCompraInputSerializer(
        many=True,
        allow_empty=False,
    )

    def validate_lineas(self, value):
        ids = [
            linea["detalle_compra_id"]
            for linea in value
        ]

        if len(ids) != len(set(ids)):
            raise serializers.ValidationError(
                "No se puede repetir una línea de compra en la recepción."
            )

        return value


# ============================================================
# ENTRADA — VENTAS
# ============================================================

class LineaVentaInputSerializer(serializers.Serializer):
    presentacion_id = serializers.IntegerField()

    cantidad = serializers.IntegerField(
        min_value=1
    )

    precio_venta = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
    )


class RegistrarVentaInputSerializer(serializers.Serializer):
    cliente_id = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=1,
    )

    cliente_nombre = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    cliente_telefono = serializers.CharField(
        max_length=20,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    fecha = serializers.DateField()

    estado_pago = serializers.ChoiceField(
        choices=Venta.EstadoPago.choices
    )

    monto_inicial = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
        required=False,
        allow_null=True,
    )

    fecha_pago = serializers.DateField(
        required=False,
        allow_null=True,
    )

    lineas = LineaVentaInputSerializer(
        many=True
    )

    def validate_fecha_pago(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError(
                "La fecha de pago no puede ser futura."
            )

        return value

    def validate(self, attrs):
        if (
            not attrs.get("cliente_id")
            and not (attrs.get("cliente_nombre") or "").strip()
        ):
            raise serializers.ValidationError({
                "cliente_nombre": (
                    "Indica un cliente existente o el nombre del "
                    "cliente para la venta."
                )
            })

        estado_pago = attrs.get("estado_pago")
        monto_inicial = attrs.get("monto_inicial")

        if (
            estado_pago == Venta.EstadoPago.ABONADO
            and monto_inicial is None
        ):
            raise serializers.ValidationError({
                "monto_inicial": (
                    "Indica el monto inicial para registrar "
                    "la venta abonada."
                )
            })

        if (
            estado_pago == Venta.EstadoPago.PENDIENTE
            and monto_inicial is not None
        ):
            raise serializers.ValidationError({
                "monto_inicial": (
                    "Una venta pendiente no puede tener pago inicial."
                )
            })

        return attrs

    def validate_lineas(self, value):
        if not value:
            raise serializers.ValidationError(
                "Debe incluir al menos un producto."
            )

        ids = [
            linea["presentacion_id"]
            for linea in value
        ]

        if len(ids) != len(set(ids)):
            raise serializers.ValidationError(
                "No se puede repetir una presentación dentro de una venta."
            )

        return value


# ============================================================
# ENTRADA — ABONOS
# ============================================================

class RegistrarAbonoInputSerializer(serializers.Serializer):
    monto = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
    )

    fecha = serializers.DateField()

    def validate_fecha(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError(
                "La fecha de pago no puede ser futura."
            )

        return value