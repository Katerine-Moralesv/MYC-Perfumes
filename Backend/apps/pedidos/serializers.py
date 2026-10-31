
import re
from collections.abc import Mapping
from decimal import Decimal

from django.utils import timezone
from rest_framework import serializers

from apps.finanzas.models import Abono
from apps.finanzas.services.inventario import disponibilidad_producto
from apps.pedidos.models import Pedido, DetallePedido
from apps.pedidos.services.cierre import pedido_listo_para_venta


MAX_CANTIDAD_POR_LINEA = 100
MAX_LINEAS_POR_PEDIDO = 20


class DetallePedidoSerializer(serializers.ModelSerializer):
    producto_nombre = serializers.SerializerMethodField()

    porcentaje_recarga = serializers.IntegerField(
        read_only=True,
    )

    subtotal = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )

    cantidad_cubierta = serializers.IntegerField(
        read_only=True,
    )
    cantidad_pendiente = serializers.IntegerField(
        read_only=True,
    )
    cantidad_reservada = serializers.SerializerMethodField()
    cantidad_disponible = serializers.SerializerMethodField()

    class Meta:
        model = DetallePedido
        fields = [
            "id",
            "producto",
            "producto_nombre",
            "presentacion",
            "porcentaje_recarga",
            "recarga_solicitada",
            "cantidad",
            "cantidad_cubierta",
            "cantidad_pendiente",
            "cantidad_reservada",
            "cantidad_disponible",
            "precio_unitario",
            "precio_pendiente",
            "subtotal",
        ]
        read_only_fields = fields

    def get_producto_nombre(self, obj):
        producto = obj.producto

        if producto is None and obj.presentacion is not None:
            producto = obj.presentacion.producto

        return producto.nombre if producto else None

    def _disponibilidad(self, obj):
        producto = obj.producto

        if producto is None and obj.presentacion_id:
            producto = obj.presentacion.producto

        if producto is None:
            return None

        cache = self.context.setdefault("_stock_cache", {})
        clave = (producto.id, obj.porcentaje_recarga)

        if clave not in cache:
            cache[clave] = disponibilidad_producto(
                producto.id,
                obj.porcentaje_recarga,
            )

        return cache[clave]

    def get_cantidad_reservada(self, obj):
        if obj.pedido.venta_id:
            return 0

        if obj.pedido.estado == Pedido.Estado.CANCELADO:
            return 0

        return obj.cantidad_recibida

    def get_cantidad_disponible(self, obj):
        disponibilidad = self._disponibilidad(obj)

        return (
            disponibilidad["disponibles"]
            if disponibilidad is not None
            else 0
        )

    def to_representation(self, instance):
        data = super().to_representation(instance)

        # Los pedidos nuevos no tienen presentación. Se omite la clave
        # para no exponer "presentacion": null. Los pedidos históricos
        # que sí la tienen conservan el campo por compatibilidad.
        if data.get("presentacion") is None:
            data.pop("presentacion", None)

        return data


class AnticipoPedidoSerializer(serializers.ModelSerializer):
    class Meta:
        model = Abono
        fields = [
            "id",
            "monto",
            "fecha",
            "tipo",
            "metodo_pago",
            "referencia",
            "creado_en",
            "registrado_por",
        ]
        read_only_fields = fields


class PedidoSerializer(serializers.ModelSerializer):
    cliente_nombre = serializers.CharField(
        source="cliente.nombre",
        read_only=True,
    )

    detalles = DetallePedidoSerializer(
        many=True,
        read_only=True,
    )

    anticipos = serializers.SerializerMethodField()
    estado_pago = serializers.SerializerMethodField()
    saldo = serializers.SerializerMethodField()
    monto_pagado = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        read_only=True,
    )
    precios_completos = serializers.SerializerMethodField()
    puede_confirmar = serializers.SerializerMethodField()
    puede_generar_venta = serializers.SerializerMethodField()
    puede_entregar = serializers.SerializerMethodField()
    unidades_pendientes_compra = serializers.SerializerMethodField()
    historial_estados = serializers.SerializerMethodField()

    class Meta:
        model = Pedido
        fields = [
            "id",
            "cliente",
            "cliente_nombre",
            "telefono_origen",
            "estado",
            "venta",
            "estado_pago",
            "total",
            "saldo",
            "monto_pagado",
            "anticipos",
            "precios_completos",
            "puede_confirmar",
            "puede_generar_venta",
            "puede_entregar",
            "unidades_pendientes_compra",
            "entregado_en",
            "entregado_por",
            "historial_estados",
            "motivo_rechazo",
            "motivo_cancelacion",
            "detalles",
            "creado_en",
        ]
        read_only_fields = fields

    def get_anticipos(self, obj):
        abonos = (
            obj.venta.abonos.all()
            if obj.venta_id
            else obj.abonos.all()
        )

        return AnticipoPedidoSerializer(
            abonos,
            many=True,
        ).data

    def get_precios_completos(self, obj):
        detalles = list(obj.detalles.all())

        return bool(detalles) and all(
            not detalle.precio_pendiente
            for detalle in detalles
        )

    def get_estado_pago(self, obj):
        if obj.venta_id:
            return obj.venta.estado_pago

        pagado = obj.monto_pagado

        if pagado <= 0:
            return "pendiente"

        if pagado >= obj.total:
            return "pagado"

        return "abonado"

    def get_saldo(self, obj):
        if obj.venta_id:
            return format(obj.venta.saldo, "f")

        return format(obj.saldo_estimado, "f")

    def get_puede_confirmar(self, obj):
        return (
            obj.estado == Pedido.Estado.PENDIENTE
            and obj.total > 0
            and self.get_precios_completos(obj)
        )

    def get_puede_generar_venta(self, obj):
        if obj.venta_id:
            return False

        return (
            obj.estado in (
                Pedido.Estado.CONFIRMADO,
                Pedido.Estado.POR_COMPRAR,
                Pedido.Estado.COMPRADO,
            )
            and pedido_listo_para_venta(obj)
        )

    def get_puede_entregar(self, obj):
        return bool(
            obj.estado == Pedido.Estado.LISTO
            and obj.venta_id
            and obj.entregado_en is None
        )

    def get_unidades_pendientes_compra(self, obj):
        return sum(
            detalle.cantidad_pendiente
            for detalle in obj.detalles.all()
        )

    def get_historial_estados(self, obj):
        return [
            {
                "id": item.id,
                "estado_anterior": item.estado_anterior,
                "estado_nuevo": item.estado_nuevo,
                "motivo": item.motivo,
                "registrado_por": item.registrado_por_id,
                "creado_en": item.creado_en.isoformat(),
            }
            for item in obj.historial_estados.all()
        ]


class PedidoTiendaSerializer(serializers.ModelSerializer):
    """
    Respuesta segura para el cliente de la tienda.

    No expone venta, saldos, pagos, datos internos del cliente ni
    información administrativa. El pedido siempre se crea pendiente.
    """

    detalles = DetallePedidoSerializer(
        many=True,
        read_only=True,
    )
    precios_completos = serializers.SerializerMethodField()

    class Meta:
        model = Pedido
        fields = [
            "id",
            "estado",
            "total",
            "precios_completos",
            "detalles",
            "creado_en",
        ]
        read_only_fields = fields

    def get_precios_completos(self, obj):
        detalles = list(obj.detalles.all())

        return bool(detalles) and all(
            not detalle.precio_pendiente
            for detalle in detalles
        )


# ENTRADA: TIENDA PÚBLICA


class SerializerEstricto(serializers.Serializer):
    """
    Rechaza campos desconocidos.

    La tienda solo puede enviar el contrato explícito. Así se evita
    que el navegador intente enviar precios, totales, estados,
    identificadores de venta o presentaciones internas.
    """

    def to_internal_value(self, data):
        if isinstance(data, Mapping):
            campos_no_permitidos = sorted(
                set(data.keys()) - set(self.fields.keys())
            )

            if campos_no_permitidos:
                raise serializers.ValidationError({
                    campo: "Campo no permitido."
                    for campo in campos_no_permitidos
                })

        return super().to_internal_value(data)


class LineaPedidoTiendaInputSerializer(SerializerEstricto):
    producto_id = serializers.IntegerField(
        min_value=1,
    )
    recarga_solicitada = serializers.BooleanField()
    porcentaje = serializers.IntegerField(
        required=False,
        allow_null=True,
    )
    cantidad = serializers.IntegerField(
        min_value=1,
        max_value=MAX_CANTIDAD_POR_LINEA,
    )

    def validate(self, attrs):
        porcentaje = attrs.get("porcentaje")
        recarga = attrs["recarga_solicitada"]

        if porcentaje is not None and porcentaje not in (
            40,
            60,
            70,
            80,
        ):
            raise serializers.ValidationError({
                "porcentaje": (
                    "El porcentaje debe ser 40, 60, 70 u 80."
                )
            })

        if recarga and porcentaje not in (60, 70, 80):
            raise serializers.ValidationError({
                "porcentaje": (
                    "Una recarga solicitada debe usar 60%, 70% u 80%."
                )
            })

        if not recarga and porcentaje not in (None, 40):
            raise serializers.ValidationError({
                "porcentaje": (
                    "Si no se solicita recarga, el porcentaje "
                    "debe ser 40%."
                )
            })

        return attrs


class RegistrarPedidoTiendaInputSerializer(SerializerEstricto):
    telefono = serializers.CharField(
        max_length=20,
        trim_whitespace=True,
    )
    nombre_cliente = serializers.CharField(
        max_length=150,
        trim_whitespace=True,
    )
    lineas = LineaPedidoTiendaInputSerializer(
        many=True,
        allow_empty=False,
    )

    def validate_telefono(self, value):
        digitos = re.sub(r"\D", "", value)

        if len(digitos) < 7 or len(digitos) > 15:
            raise serializers.ValidationError(
                "El teléfono debe contener entre 7 y 15 dígitos."
            )

        return value.strip()

    def validate_nombre_cliente(self, value):
        return value.strip()

    def validate_lineas(self, value):
        if len(value) > MAX_LINEAS_POR_PEDIDO:
            raise serializers.ValidationError(
                f"El pedido admite como máximo "
                f"{MAX_LINEAS_POR_PEDIDO} líneas."
            )

        return value


# ENTRADA: WEBHOOK


class LineaPedidoInputSerializer(serializers.Serializer):
    # Formato nuevo recomendado para el bot.
    producto_id = serializers.IntegerField(
        min_value=1,
        required=False,
    )
    recarga_solicitada = serializers.BooleanField(
        required=False,
    )
    porcentaje = serializers.IntegerField(
        required=False,
        allow_null=True,
    )

    # Compatibilidad con el contrato anterior. El servicio deduce
    # producto y porcentaje desde la presentación interna.
    presentacion_id = serializers.IntegerField(
        min_value=1,
        required=False,
    )

    cantidad = serializers.IntegerField(
        min_value=1,
        max_value=MAX_CANTIDAD_POR_LINEA,
    )

    def validate(self, attrs):
        presentacion_id = attrs.get("presentacion_id")
        producto_id = attrs.get("producto_id")
        porcentaje = attrs.get("porcentaje")
        recarga = attrs.get("recarga_solicitada")

        if not presentacion_id and not producto_id:
            raise serializers.ValidationError(
                "Debes indicar producto_id o presentacion_id."
            )

        if porcentaje is not None and porcentaje not in (
            40,
            60,
            70,
            80,
        ):
            raise serializers.ValidationError({
                "porcentaje": (
                    "El porcentaje debe ser 40, 60, 70 u 80."
                )
            })

        if recarga is True:
            if porcentaje is None and presentacion_id:
                pass
            elif porcentaje not in (60, 70, 80):
                raise serializers.ValidationError({
                    "porcentaje": (
                        "Una recarga solicitada debe usar 60%, 70% u 80%."
                    )
                })
        elif recarga is False:
            if porcentaje not in (None, 40):
                raise serializers.ValidationError({
                    "porcentaje": (
                        "Si no se solicita recarga, el porcentaje "
                        "debe ser 40%."
                    )
                })
        elif producto_id and not presentacion_id:
            raise serializers.ValidationError({
                "recarga_solicitada": (
                    "Debes indicar si la clienta solicita recarga."
                )
            })

        return attrs


class RegistrarPedidoInputSerializer(serializers.Serializer):
    telefono = serializers.CharField(
        max_length=20,
        trim_whitespace=True,
    )

    nombre_cliente = serializers.CharField(
        max_length=150,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    lineas = LineaPedidoInputSerializer(
        many=True,
        allow_empty=False,
    )

    def validate_telefono(self, value):
        if not value.strip():
            raise serializers.ValidationError(
                "El teléfono del cliente es obligatorio."
            )

        return value.strip()

    def validate_nombre_cliente(self, value):
        return value.strip()

    def validate_lineas(self, value):
        # El servicio resuelve el producto y el porcentaje final y
        # evita duplicados por producto + porcentaje.
        return value


# ENTRADA: CONFIRMACIÓN DEL PEDIDO


class LineaPrecioInputSerializer(serializers.Serializer):
    detalle_id = serializers.IntegerField(
        min_value=1,
        required=False,
    )

    # Compatibilidad con el contrato anterior. Los pedidos nuevos
    # pueden no tener presentación y deben usar detalle_id.
    presentacion_id = serializers.IntegerField(
        min_value=1,
        required=False,
    )

    precio_venta = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
    )

    def validate(self, attrs):
        if (
            not attrs.get("detalle_id")
            and not attrs.get("presentacion_id")
        ):
            raise serializers.ValidationError(
                "Debes indicar detalle_id o presentacion_id."
            )

        return attrs


class ConfirmarPedidoInputSerializer(serializers.Serializer):
    estado_pago = serializers.ChoiceField(
        choices=[
            "pagado",
            "abonado",
            "pendiente",
        ]
    )

    # Solo debe incluir recargas pendientes o que se quieran
    # corregir antes de confirmar. Las líneas sin recarga (40%)
    # conservan el precio guardado al crear el pedido.
    lineas_precio = LineaPrecioInputSerializer(
        many=True,
        required=False,
    )

    monto_recibido = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
        allow_null=True,
    )

    fecha_pago = serializers.DateField(
        required=False,
        allow_null=True,
    )

    metodo_pago = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    referencia = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    def validate_fecha_pago(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError(
                "La fecha de pago no puede ser futura."
            )

        return value

    def validate_metodo_pago(self, value):
        return value.strip()

    def validate_referencia(self, value):
        return value.strip()

    def validate_lineas_precio(self, value):
        claves = []

        for linea in value:
            if linea.get("detalle_id"):
                claves.append(("detalle", linea["detalle_id"]))
            else:
                claves.append(("presentacion", linea["presentacion_id"]))

        if len(claves) != len(set(claves)):
            raise serializers.ValidationError(
                "No se puede repetir una línea en los precios."
            )

        return value

    def validate(self, attrs):
        estado_pago = attrs["estado_pago"]
        monto = attrs.get("monto_recibido") or Decimal("0.00")

        if estado_pago == "pendiente" and monto > 0:
            raise serializers.ValidationError({
                "monto_recibido": (
                    "Si la clienta no ha pagado, el monto recibido "
                    "debe ser cero."
                )
            })

        if estado_pago == "abonado" and monto <= 0:
            raise serializers.ValidationError({
                "monto_recibido": (
                    "Debes indicar el monto recibido para un abono "
                    "parcial."
                )
            })

        if (
            estado_pago == "pagado"
            and "monto_recibido" in attrs
            and attrs["monto_recibido"] is not None
            and attrs["monto_recibido"] <= 0
        ):
            raise serializers.ValidationError({
                "monto_recibido": (
                    "Si el pago es total, el monto recibido debe "
                    "ser mayor a cero."
                )
            })

        return attrs


# ENTRADA: RECHAZO DEL PEDIDO


class RechazarPedidoInputSerializer(serializers.Serializer):
    motivo = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    def validate_motivo(self, value):
        return value.strip()


# ENTRADA: ANTICIPOS DEL PEDIDO


class RegistrarAnticipoInputSerializer(serializers.Serializer):
    monto = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.01"),
    )

    fecha = serializers.DateField()

    metodo_pago = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    referencia = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    def validate_fecha(self, value):
        if value > timezone.localdate():
            raise serializers.ValidationError(
                "La fecha del anticipo no puede ser futura."
            )

        return value

    def validate_metodo_pago(self, value):
        return value.strip()

    def validate_referencia(self, value):
        return value.strip()


# ENTRADA: CANCELACIÓN


class CancelarPedidoInputSerializer(serializers.Serializer):
    motivo = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    monto_devolucion = serializers.DecimalField(
        max_digits=12,
        decimal_places=2,
        min_value=Decimal("0.00"),
        required=False,
        allow_null=True,
    )

    fecha_devolucion = serializers.DateField(
        required=False,
        allow_null=True,
    )

    metodo_pago = serializers.CharField(
        max_length=30,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    referencia = serializers.CharField(
        max_length=120,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    def validate_fecha_devolucion(self, value):
        if value and value > timezone.localdate():
            raise serializers.ValidationError(
                "La fecha de devolución no puede ser futura."
            )

        return value

    def validate_motivo(self, value):
        return value.strip()

    def validate_metodo_pago(self, value):
        return value.strip()

    def validate_referencia(self, value):
        return value.strip()


# ENTRADA: CAMBIO DE ESTADO OPERATIVO


class CambiarEstadoPedidoInputSerializer(serializers.Serializer):
    estado = serializers.ChoiceField(
        choices=[
            Pedido.Estado.PREPARANDO,
            Pedido.Estado.LISTO,
            Pedido.Estado.ENTREGADO,
        ]
    )
    motivo = serializers.CharField(
        max_length=255,
        required=False,
        allow_blank=True,
        trim_whitespace=True,
    )

    def validate_motivo(self, value):
        return value.strip()
