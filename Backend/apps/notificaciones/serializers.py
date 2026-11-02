from rest_framework import serializers

from apps.notificaciones.models import DispositivoFCM


class RegistrarDispositivoInputSerializer(serializers.Serializer):
    token = serializers.CharField(
        max_length=4096,
        trim_whitespace=True,
    )
    plataforma = serializers.ChoiceField(
        choices=DispositivoFCM.Plataforma.choices,
        required=False,
        default=DispositivoFCM.Plataforma.WEB,
    )

    def validate_token(self, value):
        token = value.strip()

        if not token:
            raise serializers.ValidationError(
                "El token FCM es obligatorio."
            )

        return token


class DesactivarDispositivoInputSerializer(serializers.Serializer):
    token = serializers.CharField(
        max_length=4096,
        trim_whitespace=True,
    )

    def validate_token(self, value):
        token = value.strip()

        if not token:
            raise serializers.ValidationError(
                "El token FCM es obligatorio."
            )

        return token


class DispositivoFCMSerializer(serializers.ModelSerializer):
    class Meta:
        model = DispositivoFCM
        fields = [
            "id",
            "plataforma",
            "activo",
            "creado_en",
            "actualizado_en",
        ]
        read_only_fields = fields
