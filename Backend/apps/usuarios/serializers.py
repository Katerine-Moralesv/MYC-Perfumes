from rest_framework import serializers

from apps.usuarios.models import Usuario


class UsuarioSerializer(serializers.ModelSerializer):
    """
    Serializer utilizado para consultar información básica del usuario.
    """

    class Meta:
        model = Usuario
        fields = [
            "id",
            "username",
            "email",
            "rol",
        ]
        read_only_fields = [
            "id",
            "rol",
        ]


class UsuarioPerfilSerializer(serializers.ModelSerializer):
    """
    Serializer para consultar y editar el perfil propio.

    El usuario solamente puede modificar sus datos personales.
    No puede modificar su rol ni su estado de activación.
    """

    password = serializers.CharField(
        write_only=True,
        required=False,
        min_length=8,
    )

    class Meta:
        model = Usuario
        fields = [
            "id",
            "username",
            "email",
            "first_name",
            "last_name",
            "rol",
            "is_superuser",
            "password",
        ]
        read_only_fields = [
            "id",
            "rol",
            "is_superuser",
        ]

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()

        return instance


class UsuarioAdminSerializer(serializers.ModelSerializer):
    """
    Serializer utilizado por el administrador para crear y editar usuarios.
    """

    password = serializers.CharField(
        write_only=True,
        required=False,
        min_length=8,
    )

    class Meta:
        model = Usuario
        fields = [
            "id",
            "username",
            "email",
            "rol",
            "password",
            "is_active",
            "is_superuser",
        ]
        read_only_fields = ["id", "is_superuser"]

    def create(self, validated_data):
        password = validated_data.pop("password", None)

        usuario = Usuario(**validated_data)

        if password:
            usuario.set_password(password)
        else:
            raise serializers.ValidationError(
                {
                    "password": (
                        "La contraseña es obligatoria al crear un usuario."
                    )
                }
            )

        usuario.save()

        return usuario

    def update(self, instance, validated_data):
        password = validated_data.pop("password", None)

        for attr, value in validated_data.items():
            setattr(instance, attr, value)

        if password:
            instance.set_password(password)

        instance.save()

        return instance

class SolicitarRecuperacionSerializer(serializers.Serializer):
    """
    Recibe el correo electrónico para solicitar
    una recuperación de contraseña.
    """

    email = serializers.EmailField()


class VerificarCodigoSerializer(serializers.Serializer):
    """
    Recibe el correo y el código de recuperación.
    """

    email = serializers.EmailField()

    codigo = serializers.CharField(
        min_length=6,
        max_length=6,
        trim_whitespace=True,
    )

    def validate_codigo(self, value):
        if not value.isdigit():
            raise serializers.ValidationError(
                "El código debe contener únicamente números."
            )

        return value


class RestablecerPasswordSerializer(serializers.Serializer):
    """
    Recibe el correo, token temporal y nueva contraseña.
    """

    email = serializers.EmailField()

    reset_token = serializers.CharField(
        min_length=20,
        trim_whitespace=True,
    )

    new_password = serializers.CharField(
        write_only=True,
        min_length=8,
    )