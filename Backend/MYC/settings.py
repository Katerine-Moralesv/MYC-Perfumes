
"""
Django settings for MYC project.
"""

import os
from pathlib import Path

import dj_database_url
from decouple import config
from django.core.exceptions import ImproperlyConfigured


# =========================================================
# RUTA BASE
# =========================================================

BASE_DIR = Path(__file__).resolve().parent.parent


# =========================================================
# SEGURIDAD
# =========================================================

SECRET_KEY = config("SECRET_KEY")

IS_PRODUCTION = config(
    "IS_PRODUCTION",
    default=False,
    cast=bool,
)

# En producción DEBUG nunca puede quedar activo por error.
DEBUG = (
    False
    if IS_PRODUCTION
    else config(
        "DEBUG",
        default=True,
        cast=bool,
    )
)

ALLOWED_HOSTS = [
    host.strip()
    for host in config(
        "ALLOWED_HOSTS",
        default="localhost,127.0.0.1",
    ).split(",")
    if host.strip()
]

# Render expone automáticamente el hostname público del servicio.
RENDER_EXTERNAL_HOSTNAME = os.environ.get(
    "RENDER_EXTERNAL_HOSTNAME",
    "",
).strip()

if RENDER_EXTERNAL_HOSTNAME and (
    RENDER_EXTERNAL_HOSTNAME not in ALLOWED_HOSTS
):
    ALLOWED_HOSTS.append(RENDER_EXTERNAL_HOSTNAME)


# =========================================================
# APLICACIONES
# =========================================================

INSTALLED_APPS = [
    # Django
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",

    # Terceros
    "rest_framework",
    "rest_framework_simplejwt",
    "corsheaders",
    "django_filters",

    # Aplicaciones MYC
    "apps.core",
    "apps.usuarios",
    "apps.catalogo",
    "apps.finanzas",
    "apps.pedidos",
    "apps.notificaciones",
]


# =========================================================
# MIDDLEWARE
# =========================================================

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "whitenoise.middleware.WhiteNoiseMiddleware",
    "corsheaders.middleware.CorsMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]


# =========================================================
# URLS / WSGI
# =========================================================

ROOT_URLCONF = "MYC.urls"

WSGI_APPLICATION = "MYC.wsgi.application"


# =========================================================
# TEMPLATES
# =========================================================

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]


# =========================================================
# BASE DE DATOS - POSTGRESQL
# =========================================================

# DATABASE_URL tiene prioridad. Se usa en Supabase y en Render.
DATABASE_URL = config("DATABASE_URL", default="").strip()

DB_SSL_REQUIRE = config(
    "DB_SSL_REQUIRE",
    default=IS_PRODUCTION,
    cast=bool,
)

DB_CONN_MAX_AGE = config(
    "DB_CONN_MAX_AGE",
    default=600 if IS_PRODUCTION else 0,
    cast=int,
)

DB_CONN_HEALTH_CHECKS = config(
    "DB_CONN_HEALTH_CHECKS",
    default=True,
    cast=bool,
)

DB_NAME = config("DB_NAME", default="").strip()

if DATABASE_URL:
    DATABASES = {
        "default": dj_database_url.parse(
            DATABASE_URL,
            conn_max_age=DB_CONN_MAX_AGE,
            conn_health_checks=DB_CONN_HEALTH_CHECKS,
            ssl_require=DB_SSL_REQUIRE,
        )
    }

    if DB_SSL_REQUIRE:
        DATABASES["default"].setdefault(
            "OPTIONS",
            {},
        ).setdefault("sslmode", "require")

elif DB_NAME:
    # Compatibilidad con la configuración local por variables separadas.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.postgresql",
            "NAME": DB_NAME,
            "USER": config("DB_USER", default=""),
            "PASSWORD": config("DB_PASSWORD", default=""),
            "HOST": config(
                "DB_HOST",
                default="127.0.0.1",
            ),
            "PORT": config(
                "DB_PORT",
                default="5432",
            ),
            "CONN_MAX_AGE": DB_CONN_MAX_AGE,
            "CONN_HEALTH_CHECKS": DB_CONN_HEALTH_CHECKS,
        }
    }

    if DB_SSL_REQUIRE:
        DATABASES["default"]["OPTIONS"] = {
            "sslmode": "require",
        }

else:
    # Fallback para desarrollo sin PostgreSQL ni DATABASE_URL.
    DATABASES = {
        "default": {
            "ENGINE": "django.db.backends.sqlite3",
            "NAME": BASE_DIR / "db.sqlite3",
        }
    }


# =========================================================
# MODELO DE USUARIO
# =========================================================

AUTH_USER_MODEL = "usuarios.Usuario"


# =========================================================
# VALIDACIÓN DE CONTRASEÑAS
# =========================================================

AUTH_PASSWORD_VALIDATORS = [
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "UserAttributeSimilarityValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "MinimumLengthValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "CommonPasswordValidator"
        ),
    },
    {
        "NAME": (
            "django.contrib.auth.password_validation."
            "NumericPasswordValidator"
        ),
    },
]


# =========================================================
# DJANGO REST FRAMEWORK
# =========================================================

REST_FRAMEWORK = {
    # Manejo centralizado de errores
    "EXCEPTION_HANDLER": "apps.core.handlers.exception_handler",

    # Autenticación JWT
    "DEFAULT_AUTHENTICATION_CLASSES": [
        "rest_framework_simplejwt.authentication.JWTAuthentication",
    ],

    # Por defecto, todos los endpoints requieren autenticación.
    # Los endpoints públicos declararán AllowAny explícitamente.
    "DEFAULT_PERMISSION_CLASSES": [
        "rest_framework.permissions.IsAuthenticated",
    ],

    # Filtros
    "DEFAULT_FILTER_BACKENDS": [
        "django_filters.rest_framework.DjangoFilterBackend",
    ],

    # Límites de solicitudes
    "DEFAULT_THROTTLE_RATES": {
        "login": "5/min",
        "webhook": "60/min",
        "pedido_tienda": "10/min",
        "password_recovery": "3/hour",
        "password_recovery_verify": "10/hour",
        "password_recovery_reset": "10/hour",
    },
}


# =========================================================
# CORS
# =========================================================

CORS_ALLOWED_ORIGINS = [
    origin.strip()
    for origin in config(
        "CORS_ALLOWED_ORIGINS",
        default="http://localhost:5173",
    ).split(",")
    if origin.strip()
]


# =========================================================
# CSRF
# =========================================================

CSRF_TRUSTED_ORIGINS = [
    origin.strip()
    for origin in config(
        "CSRF_TRUSTED_ORIGINS",
        default="",
    ).split(",")
    if origin.strip()
]

if RENDER_EXTERNAL_HOSTNAME:
    render_origin = f"https://{RENDER_EXTERNAL_HOSTNAME}"

    if render_origin not in CSRF_TRUSTED_ORIGINS:
        CSRF_TRUSTED_ORIGINS.append(render_origin)


# =========================================================
# WEBHOOK
# =========================================================

WEBHOOK_TOKEN = config(
    "WEBHOOK_TOKEN",
    default="",
)


# =========================================================
# FIREBASE CLOUD MESSAGING
# =========================================================

# Cuenta de servicio codificada en Base64. Es un secreto privado:
# no debe guardarse en el repositorio ni exponerse al frontend.
FIREBASE_CREDENTIALS_BASE64 = config(
    "FIREBASE_CREDENTIALS_BASE64",
    default="",
)


# =========================================================
# IDIOMA Y ZONA HORARIA
# =========================================================

LANGUAGE_CODE = "es-co"

TIME_ZONE = "America/Bogota"

USE_I18N = True

USE_TZ = True


# =========================================================
# ARCHIVOS ESTÁTICOS
# =========================================================

STATIC_URL = "/static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

STORAGES = {
    "default": {
        "BACKEND": "django.core.files.storage.FileSystemStorage",
    },
    "staticfiles": {
        "BACKEND": "whitenoise.storage.CompressedManifestStaticFilesStorage",
    },
}


# =========================================================
# ARCHIVOS MULTIMEDIA
# =========================================================

MEDIA_URL = "/media/"

MEDIA_ROOT = BASE_DIR / "media"

# En desarrollo se conserva el almacenamiento local. En producción se
# activa Supabase Storage (API compatible con S3) por defecto.
USE_SUPABASE_STORAGE = config(
    "USE_SUPABASE_STORAGE",
    default=IS_PRODUCTION,
    cast=bool,
)

# Evita que archivos de hasta 10 MB se escriban en el disco temporal.
FILE_UPLOAD_MAX_MEMORY_SIZE = config(
    "FILE_UPLOAD_MAX_MEMORY_SIZE",
    default=10 * 1024 * 1024,
    cast=int,
)

if USE_SUPABASE_STORAGE:
    SUPABASE_URL = config(
        "SUPABASE_URL",
        default="",
    ).strip().rstrip("/")

    SUPABASE_STORAGE_BUCKET = config(
        "SUPABASE_STORAGE_BUCKET",
        default="productos",
    ).strip()

    SUPABASE_S3_ENDPOINT = config(
        "SUPABASE_S3_ENDPOINT",
        default=(
            f"{SUPABASE_URL}/storage/v1/s3"
            if SUPABASE_URL
            else ""
        ),
    ).strip().rstrip("/")

    SUPABASE_S3_REGION = config(
        "SUPABASE_S3_REGION",
        default="sa-east-1",
    ).strip()

    SUPABASE_S3_ACCESS_KEY_ID = config(
        "SUPABASE_S3_ACCESS_KEY_ID",
        default="",
    ).strip()

    SUPABASE_S3_SECRET_ACCESS_KEY = config(
        "SUPABASE_S3_SECRET_ACCESS_KEY",
        default="",
    ).strip()

    SUPABASE_STORAGE_PUBLIC_URL = config(
        "SUPABASE_STORAGE_PUBLIC_URL",
        default=(
            f"{SUPABASE_URL}/storage/v1/object/public/"
            f"{SUPABASE_STORAGE_BUCKET}"
            if SUPABASE_URL and SUPABASE_STORAGE_BUCKET
            else ""
        ),
    ).strip().rstrip("/")

    SUPABASE_STORAGE_QUERYSTRING_AUTH = config(
        "SUPABASE_STORAGE_QUERYSTRING_AUTH",
        default=False,
        cast=bool,
    )

    faltantes = [
        nombre
        for nombre, valor in (
            ("SUPABASE_URL", SUPABASE_URL),
            ("SUPABASE_STORAGE_BUCKET", SUPABASE_STORAGE_BUCKET),
            ("SUPABASE_S3_ENDPOINT", SUPABASE_S3_ENDPOINT),
            ("SUPABASE_S3_REGION", SUPABASE_S3_REGION),
            ("SUPABASE_S3_ACCESS_KEY_ID", SUPABASE_S3_ACCESS_KEY_ID),
            (
                "SUPABASE_S3_SECRET_ACCESS_KEY",
                SUPABASE_S3_SECRET_ACCESS_KEY,
            ),
            (
                "SUPABASE_STORAGE_PUBLIC_URL",
                SUPABASE_STORAGE_PUBLIC_URL,
            ),
        )
        if not valor
    ]

    if faltantes:
        raise ImproperlyConfigured(
            "USE_SUPABASE_STORAGE está activo pero faltan variables "
            "de entorno: " + ", ".join(faltantes)
        )

    # django-storages construye la URL como
    # https://<custom_domain>/<ruta>. Por eso el dominio personalizado
    # incluye la ruta pública del bucket de Supabase.
    if SUPABASE_STORAGE_PUBLIC_URL.startswith("http://"):
        AWS_S3_URL_PROTOCOL = "http:"
        AWS_S3_CUSTOM_DOMAIN = SUPABASE_STORAGE_PUBLIC_URL[len("http://"):]
    else:
        AWS_S3_URL_PROTOCOL = "https:"
        AWS_S3_CUSTOM_DOMAIN = SUPABASE_STORAGE_PUBLIC_URL.removeprefix(
            "https://"
        )

    AWS_ACCESS_KEY_ID = SUPABASE_S3_ACCESS_KEY_ID
    AWS_SECRET_ACCESS_KEY = SUPABASE_S3_SECRET_ACCESS_KEY
    AWS_STORAGE_BUCKET_NAME = SUPABASE_STORAGE_BUCKET
    AWS_S3_ENDPOINT_URL = SUPABASE_S3_ENDPOINT
    AWS_S3_REGION_NAME = SUPABASE_S3_REGION
    AWS_S3_SIGNATURE_VERSION = "s3v4"
    AWS_S3_ADDRESSING_STYLE = "path"
    AWS_DEFAULT_ACL = None
    AWS_S3_FILE_OVERWRITE = False
    AWS_QUERYSTRING_AUTH = SUPABASE_STORAGE_QUERYSTRING_AUTH
    AWS_S3_OBJECT_PARAMETERS = {
        "CacheControl": "public, max-age=86400",
    }

    STORAGES["default"] = {
        "BACKEND": "storages.backends.s3.S3Storage",
    }

    MEDIA_URL = f"{SUPABASE_STORAGE_PUBLIC_URL}/"


# =========================================================
# CORREO ELECTRÓNICO
# =========================================================

# SMTP configurable desde variables de entorno. Para desarrollo local se
# puede establecer EMAIL_BACKEND=django.core.mail.backends.console.EmailBackend.
EMAIL_BACKEND = config(
    "EMAIL_BACKEND",
    default="django.core.mail.backends.smtp.EmailBackend",
)

EMAIL_HOST = config("EMAIL_HOST", default="")
EMAIL_PORT = config("EMAIL_PORT", default=587, cast=int)
EMAIL_USE_SSL = config("EMAIL_USE_SSL", default=False, cast=bool)
EMAIL_USE_TLS = config(
    "EMAIL_USE_TLS",
    default=not EMAIL_USE_SSL,
    cast=bool,
)
EMAIL_HOST_USER = config("EMAIL_HOST_USER", default="")
EMAIL_HOST_PASSWORD = config("EMAIL_HOST_PASSWORD", default="")
EMAIL_TIMEOUT = config("EMAIL_TIMEOUT", default=10, cast=int)

# Tiempo máximo que la petición espera al proveedor de correo.
# Si se agota, la API responde sin bloquear y el envío continúa en
# segundo plano.
PASSWORD_RECOVERY_EMAIL_WAIT_SECONDS = config(
    "PASSWORD_RECOVERY_EMAIL_WAIT_SECONDS",
    default=3,
    cast=int,
)

DEFAULT_FROM_EMAIL = config(
    "DEFAULT_FROM_EMAIL",
    default="MYC Perfumes <no-reply@mycperfumes.com>",
)


# =========================================================
# CONFIGURACIÓN DE DJANGO
# =========================================================

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# =========================================================
# SEGURIDAD EN PRODUCCIÓN
# =========================================================

if IS_PRODUCTION:
    # Render termina TLS y envía X-Forwarded-Proto.
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

    SESSION_COOKIE_SECURE = config(
        "SESSION_COOKIE_SECURE",
        default=True,
        cast=bool,
    )

    CSRF_COOKIE_SECURE = config(
        "CSRF_COOKIE_SECURE",
        default=True,
        cast=bool,
    )

    SECURE_SSL_REDIRECT = config(
        "SECURE_SSL_REDIRECT",
        default=True,
        cast=bool,
    )

    SECURE_HSTS_SECONDS = config(
        "SECURE_HSTS_SECONDS",
        default=31536000,
        cast=int,
    )

    SECURE_HSTS_INCLUDE_SUBDOMAINS = config(
        "SECURE_HSTS_INCLUDE_SUBDOMAINS",
        default=False,
        cast=bool,
    )

    SECURE_HSTS_PRELOAD = config(
        "SECURE_HSTS_PRELOAD",
        default=False,
        cast=bool,
    )

    SECURE_CONTENT_TYPE_NOSNIFF = True
    SECURE_REFERRER_POLICY = "same-origin"


# =========================================================
# REGISTRO DE ERRORES
# =========================================================

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "estandar": {
            "format": (
                "%(asctime)s %(levelname)s %(name)s "
                "%(message)s"
            ),
        },
    },
    "handlers": {
        "consola": {
            "class": "logging.StreamHandler",
            "formatter": "estandar",
        },
    },
    "root": {
        "handlers": ["consola"],
        "level": config("LOG_LEVEL", default="INFO"),
    },
    "loggers": {
        "django.request": {
            "handlers": ["consola"],
            "level": "ERROR",
            "propagate": False,
        },
    },
}