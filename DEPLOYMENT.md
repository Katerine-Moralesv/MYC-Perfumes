# Despliegue de MYC Perfumes

Guía para desplegar el backend Django en Render y el frontend React en
Cloudflare Pages, usando Supabase para PostgreSQL y para el almacenamiento
de imágenes.

> Esta guía no crea recursos ni aplica migraciones automáticamente.
> Todos los pasos que modifican datos requieren tu autorización expresa.

---

## 1. Crear el proyecto en Supabase

1. Entra en <https://supabase.com> y crea una cuenta o inicia sesión.
2. Crea un proyecto nuevo:
   - **Name:** `myc-perfumes`
   - **Database Password:** usa una contraseña larga y guárdala en un
     gestor de secretos. La necesitarás para `DATABASE_URL`.
   - **Region:** la más cercana a tus usuarios y a Render.
3. Espera a que termine el aprovisionamiento.
4. Anota el **Project Reference ID**. Aparece en la URL del panel:
   `https://supabase.com/dashboard/project/<PROJECT_REF>`.
5. La URL pública del proyecto es:
   `https://<PROJECT_REF>.supabase.co`.

### Plan gratuito

El plan gratuito de Supabase puede pausar el proyecto por inactividad.
Si la API empieza a responder errores de conexión después de varios días
sin tráfico, revisa el estado del proyecto en Supabase y reactívalo.

---

## 2. Obtener la conexión PostgreSQL

En Supabase abre **Project Settings > Database > Connection string**.

Supabase ofrece tres formas de conexión:

| Tipo | Host | Puerto | Uso recomendado |
| --- | --- | --- | --- |
| Conexión directa | `db.<PROJECT_REF>.supabase.co` | `5432` | Solo si el proveedor soporta IPv6 |
| Session Pooler | `aws-0-<REGION>.pooler.supabase.com` | `5432` | **Recomendado para Render** |
| Transaction Pooler | `aws-0-<REGION>.pooler.supabase.com` | `6543` | Funciones serverless de corta duración |

### Decisión para Render

Usa el **Session Pooler** (puerto `5432`). Render mantiene procesos
Gunicorn vivos y reutiliza conexiones; el Session Pooler es compatible
con conexiones persistentes y con la semántica transaccional de Django.

La conexión directa puede fallar en Render si no hay salida IPv6. El
Transaction Pooler usa conexiones cortas y requiere `DB_CONN_MAX_AGE=0`;
no es la opción recomendada para este proyecto.

La cadena del Session Pooler tiene esta forma:

```text
postgresql://postgres.<PROJECT_REF>:<PASSWORD>@aws-0-<REGION>.pooler.supabase.com:5432/postgres?sslmode=require
```

Notas:

- El usuario del Session Pooler incluye el Project Ref:
  `postgres.<PROJECT_REF>`.
- Añade `?sslmode=require`. El proyecto también fuerza SSL con
  `DB_SSL_REQUIRE=True`.
- Si la contraseña tiene caracteres especiales, codifícalos para URL
  (`@` → `%40`, `#` → `%23`, etc.) o usa el botón de Supabase para copiar
  la cadena completa.
- No escribas esta cadena en el repositorio. Va únicamente en `.env`
  local o en las variables de Render.

---

## 3. Crear el bucket de almacenamiento

1. En Supabase abre **Storage**.
2. Crea un bucket llamado exactamente `productos`.
3. Activa la opción de **bucket público** para las fotografías del
   catálogo.

### Implicaciones de un bucket público

Las fotografías de productos son información comercial que ya se muestra
en la tienda. Con un bucket público:

- Cualquier persona que conozca la URL de una imagen puede verla.
- Las imágenes se sirven sin tokens ni URLs firmadas que caduquen.
- **Escribir, reemplazar o eliminar** archivos sigue requiriendo las
  credenciales S3 del backend. El público solo puede leer.
- No subas al bucket documentos privados, facturas, comprobantes ni datos
  personales.

Si en el futuro necesitas un bucket privado, cambia el enfoque a URLs
firmadas. Esta guía y la configuración actual asumen un bucket público.

La ruta pública base queda así:

```text
https://<PROJECT_REF>.supabase.co/storage/v1/object/public/productos
```

Los archivos se guardan con la misma ruta relativa que usa Django. Por
ejemplo, una foto de producto se guarda como `productos/archivo.png`
dentro del bucket. La URL final es:

```text
https://<PROJECT_REF>.supabase.co/storage/v1/object/public/productos/productos/archivo.png
```

Esa duplicación de `productos` es correcta: la primera aparición es el
bucket y la segunda es la carpeta definida por `upload_to="productos/"`.

---

## 4. Obtener las credenciales S3 de Supabase

En Supabase abre **Storage > S3 access keys** (en algunas versiones del
panel aparece dentro de **Project Settings > Storage**).

1. Crea una clave S3.
2. Guarda:
   - **Access key ID** → `SUPABASE_S3_ACCESS_KEY_ID`
   - **Secret access key** → `SUPABASE_S3_SECRET_ACCESS_KEY`
3. No uses la clave `service_role` en React ni la publiques.
4. Estas claves son secretas y solo se configuran en el backend.

Datos que debes identificar:

| Dato | Valor |
| --- | --- |
| Endpoint S3 | `https://<PROJECT_REF>.supabase.co/storage/v1/s3` |
| Región | La región del proyecto, por ejemplo `us-east-1` |
| Bucket | `productos` |
| URL pública | `https://<PROJECT_REF>.supabase.co/storage/v1/object/public/productos` |

El backend configura automáticamente:

- Firma `s3v4`.
- Direccionamiento tipo path (`path style`).
- Sin ACL por objeto (`AWS_DEFAULT_ACL = None`).
- Sin sobrescritura de archivos (`AWS_S3_FILE_OVERWRITE = False`).
- URLs públicas sin firma para bucket público.

---

## 5. Configurar las variables de entorno

### Backend

Copia `Backend/.env.example` a `Backend/.env` en local. En Render configura
las mismas variables en **Environment**.

Variables principales:

| Variable | Producción | Dónde se obtiene |
| --- | --- | --- |
| `SECRET_KEY` | Obligatoria | Render puede generarla o usa una cadena aleatoria larga |
| `DEBUG` | `False` | Fijo en producción |
| `IS_PRODUCTION` | `True` | Activa seguridad y storage remoto |
| `ALLOWED_HOSTS` | `<backend>.onrender.com` | Render > Settings > Domains |
| `CORS_ALLOWED_ORIGINS` | `https://<frontend>.pages.dev` | Cloudflare Pages > dominio del proyecto |
| `CSRF_TRUSTED_ORIGINS` | `https://<backend>.onrender.com,https://<frontend>.pages.dev` | Dominios reales |
| `DATABASE_URL` | Session Pooler de Supabase | Supabase > Database > Connection string |
| `DB_SSL_REQUIRE` | `True` | Fijo para Supabase |
| `DB_CONN_MAX_AGE` | `600` | Session Pooler |
| `DB_CONN_HEALTH_CHECKS` | `True` | Recomendado |
| `USE_SUPABASE_STORAGE` | `True` | Activa S3 |
| `SUPABASE_URL` | `https://<PROJECT_REF>.supabase.co` | Supabase |
| `SUPABASE_STORAGE_BUCKET` | `productos` | Bucket creado |
| `SUPABASE_S3_ENDPOINT` | `https://<PROJECT_REF>.supabase.co/storage/v1/s3` | Supabase Storage > S3 |
| `SUPABASE_S3_REGION` | Región del proyecto | Supabase |
| `SUPABASE_S3_ACCESS_KEY_ID` | Clave S3 | Supabase Storage > S3 access keys |
| `SUPABASE_S3_SECRET_ACCESS_KEY` | Clave S3 secreta | Supabase Storage > S3 access keys |
| `SUPABASE_STORAGE_PUBLIC_URL` | URL pública del bucket | Supabase, o se deduce automáticamente |
| `SUPABASE_STORAGE_QUERYSTRING_AUTH` | `False` | Bucket público |
| `WEBHOOK_TOKEN` | Token interno | Cadena aleatoria |
| `EMAIL_*` | Credenciales SMTP | Proveedor de correo |

Variables opcionales de seguridad:

| Variable | Valor recomendado |
| --- | --- |
| `SESSION_COOKIE_SECURE` | `True` |
| `CSRF_COOKIE_SECURE` | `True` |
| `SECURE_SSL_REDIRECT` | `True` |
| `SECURE_HSTS_SECONDS` | `31536000` |
| `SECURE_HSTS_INCLUDE_SUBDOMAINS` | `False` |
| `SECURE_HSTS_PRELOAD` | `False` |
| `LOG_LEVEL` | `INFO` |

> `IS_PRODUCTION=True` fuerza `DEBUG=False` aunque `DEBUG` tenga otro
> valor. No uses `IS_PRODUCTION=True` en local.

### Frontend

Copia `Frontend/.env.example` a `Frontend/.env.local` en desarrollo. En
Cloudflare Pages configura:

| Variable | Valor |
| --- | --- |
| `VITE_API_URL` | `https://<backend>.onrender.com/api/v1` |
| `NODE_VERSION` | `22` (o una versión soportada por Vite 8) |

No pongas secretos en variables `VITE_*`: se incluyen en el JavaScript
público.

---

## 6. Preparar Render

### Opción A: Blueprint con `render.yaml`

El repositorio incluye `render.yaml`. En Render:

1. **New > Blueprint**.
2. Conecta el repositorio.
3. Render leerá `render.yaml` y creará el servicio.
4. Completa las variables marcadas con `sync: false`.

### Opción B: Web Service manual

1. **New > Web Service**.
2. Conecta el repositorio.
3. Configura:
   - **Root Directory:** `Backend`
   - **Runtime:** Python
   - **Build Command:** `bash build.sh`
   - **Start Command:**
     ```text
     gunicorn MYC.wsgi:application --bind 0.0.0.0:$PORT --workers 2 --threads 2 --timeout 120 --access-logfile - --error-logfile -
     ```
   - **Health Check Path:** `/api/v1/catalogo/categorias/`
   - **Plan:** Free
4. No agregues un disco persistente. Las imágenes van a Supabase.

`build.sh` instala dependencias y ejecuta `collectstatic`. **No ejecuta
migraciones** de forma automática.

Si Render no ofrece Python `3.14.4`, cambia `PYTHON_VERSION` a una versión
compatible disponible y verifica que Django 6.1.1 y `psycopg` funcionen.

---

## 7. Desplegar el backend

1. Crea el servicio en Render con las variables del punto 5.
2. Espera a que el build termine.
3. Abre **Render Shell** y revisa el estado de las migraciones:

   ```bash
   python manage.py showmigrations --plan
   ```

4. **No apliques migraciones todavía.** Revisa el plan y confirma qué
   migraciones están pendientes. En una base nueva de Supabase aparecerán
   todas las migraciones pendientes. Aplicarlas requiere tu autorización
   expresa.

5. Cuando autorices las migraciones, ejecuta en Render Shell:

   ```bash
   python manage.py migrate
   ```

6. Si vas a usar el admin de Django, crea un superusuario:

   ```bash
   python manage.py createsuperuser
   ```

   Si tu plan de Render no ofrece Shell, ejecuta estos comandos desde tu
   equipo con `DATABASE_URL` apuntando a Supabase. Antes de hacerlo,
   confirma que `IS_PRODUCTION=False` y `USE_SUPABASE_STORAGE=False` para
   evitar efectos no deseados en local.

7. Comprueba que el servicio responde:

   ```bash
   curl -i https://<backend>.onrender.com/api/v1/catalogo/categorias/
   ```

---

## 8. Preparar Cloudflare Pages

1. Entra en <https://dash.cloudflare.com> > **Workers & Pages**.
2. **Create application > Pages > Connect to Git**.
3. Selecciona el repositorio.
4. Configura:
   - **Project name:** `myc-perfumes`
   - **Production branch:** la rama que uses para producción.
   - **Framework preset:** Vite
   - **Root directory:** `Frontend`
   - **Build command:** `npm ci && npm run build`
   - **Build output directory:** `dist`
   - **Node version:** `22` (variable `NODE_VERSION`)
5. En **Environment variables** agrega:
   - `VITE_API_URL=https://<backend>.onrender.com/api/v1`
   - `NODE_VERSION=22`
6. Guarda y despliega.

El archivo `Frontend/public/_redirects` ya contiene el fallback SPA:

```text
/* /index.html 200
```

Vite lo copia a `dist/_redirects`, por lo que rutas como `/catalogo` o
`/contacto` funcionan al recargar directamente.

---

## 9. Desplegar el frontend

1. Ejecuta una compilación local para verificar:

   ```bash
   cd Frontend
   npm ci
   npm run build
   ```

2. Confirma que `Frontend/dist/_redirects` existe.
3. Haz commit y push de los cambios.
4. Cloudflare Pages compilará y publicará el sitio.
5. Abre la URL `https://<frontend>.pages.dev`.

---

## 10. Configurar CORS y CSRF

Con estos dominios de ejemplo:

- Backend: `https://myc-perfumes-api.onrender.com`
- Frontend: `https://myc-perfumes.pages.dev`

Configura en Render:

```env
ALLOWED_HOSTS=myc-perfumes-api.onrender.com
CORS_ALLOWED_ORIGINS=https://myc-perfumes.pages.dev
CSRF_TRUSTED_ORIGINS=https://myc-perfumes-api.onrender.com,https://myc-perfumes.pages.dev
```

Reglas:

- `ALLOWED_HOSTS` no lleva esquema ni barras finales.
- `CORS_ALLOWED_ORIGINS` y `CSRF_TRUSTED_ORIGINS` llevan esquema y no
  llevan barra final.
- Si usas un dominio propio, agrégalo a las tres variables.
- Render agrega automáticamente `https://<RENDER_EXTERNAL_HOSTNAME>` a
  `CSRF_TRUSTED_ORIGINS`, pero es mejor declararlo explícitamente.
- Si cambias el dominio de Cloudflare Pages, actualiza Render y vuelve a
  desplegar el backend.

---

## 11. Comprobar que la API funciona

```bash
# Catálogo público
curl -i https://<backend>.onrender.com/api/v1/catalogo/categorias/

# Productos públicos
curl -i https://<backend>.onrender.com/api/v1/catalogo/productos/

# Archivos estáticos de WhiteNoise
curl -I https://<backend>.onrender.com/static/admin/css/base.css

# Admin de Django
# Abre https://<backend>.onrender.com/admin/ en el navegador
```

Verifica también el preflight de CORS:

```bash
curl -i -X OPTIONS https://<backend>.onrender.com/api/v1/catalogo/categorias/ \
  -H "Origin: https://<frontend>.pages.dev" \
  -H "Access-Control-Request-Method: GET"
```

Debe aparecer `Access-Control-Allow-Origin` con el origen del frontend.

Desde el navegador abre el frontend y confirma que el catálogo carga sin
errores de red en la consola.

---

## 12. Comprobar el almacenamiento de imágenes

1. Abre `https://<backend>.onrender.com/admin/`.
2. Entra en **Productos** y edita un producto.
3. Sube una imagen y guarda.
4. Verifica que la URL de `foto` en la API sea pública, por ejemplo:

   ```text
   https://<PROJECT_REF>.supabase.co/storage/v1/object/public/productos/productos/archivo.png
   ```

5. Confirma que el archivo aparece en **Supabase > Storage > productos**.
6. Confirma que la imagen se ve en el frontend.
7. Reemplaza la imagen por otra y guarda. Debe mostrarse la nueva.
8. Usa **Quitar foto** en el admin y guarda. El producto debe quedar sin
   imagen.
9. Reinicia el servicio de Render y confirma que las imágenes siguen
   visibles: eso demuestra que no dependen del disco efímero.

En local, sin `USE_SUPABASE_STORAGE=True`, las imágenes se guardan en
`Backend/media/` y se sirven desde `/media/`. Ese comportamiento se
mantiene intacto.

---

## 13. Migrar los datos locales (solo con autorización)

> **No ejecutes esta sección sin autorización expresa.**
> No se ha aplicado ninguna migración ni se ha copiado ningún dato.

> **Nunca ejecutes `python manage.py test` con `DATABASE_URL` apuntando a
> Supabase.** Django crea y destruye una base de datos de pruebas; no debe
> apuntar nunca a un proyecto real.

La migración debe hacerse en una ventana controlada y con respaldo previo.

### 13.1 Respaldar la base local

Si la base local es PostgreSQL:

```bash
pg_dump "postgresql://<usuario>:<clave>@127.0.0.1:5432/<base_local>" \
  --no-owner --no-privileges \
  --file=respaldo_local.sql
```

Si la fuente real es SQLite, respalda el archivo:

```bash
cp Backend/db.sqlite3 respaldo_db.sqlite3
```

No restaures `db.sqlite3` sobre Supabase. Son motores distintos.

### 13.2 Crear el esquema en Supabase

Con autorización para aplicar migraciones:

```bash
# En Render Shell, apuntando DATABASE_URL a Supabase
python manage.py migrate
```

### 13.3 Copiar datos

Opción PostgreSQL → PostgreSQL:

```bash
# Exportar solo datos (el esquema ya debe existir en Supabase)
pg_dump "postgresql://<usuario>:<clave>@127.0.0.1:5432/<base_local>" \
  --data-only --no-owner --no-privileges \
  --exclude-table=django_migrations \
  --file=datos_locales.sql

# Cargar en Supabase (usa la cadena del Session Pooler)
psql "$DATABASE_URL" --file=datos_locales.sql
```

Opción SQLite → PostgreSQL:

```bash
# Exportar desde la configuración local con SQLite
python manage.py dumpdata \
  --natural-foreign --natural-primary \
  --exclude=contenttypes \
  --exclude=auth.permission \
  --exclude=sessions \
  --exclude=admin.logentry \
  --indent=2 \
  --output=datos_locales.json

# Cargar en Supabase
python manage.py loaddata datos_locales.json
```

Revisa el resultado antes de continuar. No cargues respaldos sin probarlos
primero en una base de ensayo.

> **Conflicto importante con datos iniciales:** algunas migraciones
> crean filas por defecto (por ejemplo, `catalogo.0006_categorias_predefinidas`).
> Si primero ejecutas `migrate` y después cargas un volcado de datos que
> también contiene esas filas, pueden aparecer errores de clave única.
> Por eso conviene probar el procedimiento en un proyecto de ensayo.
>
> Alternativa recomendada para una copia exacta: crear un proyecto
> temporal de Supabase, restaurar allí un volcado lógico completo del
> esquema `public` local (esquema + datos, sin propietarios ni ACL) y
> validar la aplicación antes de usarlo como producción. No apliques
> `--clean` sobre una base con datos que quieras conservar.

### 13.4 Copiar imágenes locales

Los archivos de `Backend/media/` no se migran solos. Súbelos al bucket
`productos` conservando la ruta relativa:

```text
Backend/media/productos/badee_perfume.png
→ bucket productos, clave productos/badee_perfume.png
```

No renombres archivos ni cambies las rutas guardadas en la base de datos.
También puedes usar el panel de Supabase o la CLI de Supabase para subir
la carpeta completa.

### 13.5 Verificación posterior

1. `python manage.py showmigrations --plan` debe mostrar todo aplicado.
2. Revisa que el número de productos, pedidos y usuarios coincida.
3. Abre el catálogo y confirma que las imágenes cargan desde Supabase.
4. Conserva el respaldo local hasta validar la aplicación en producción.

---

## 14. Lista de verificación final

- [ ] Proyecto de Supabase creado.
- [ ] Bucket `productos` creado y público.
- [ ] Claves S3 creadas y guardadas.
- [ ] `DATABASE_URL` del Session Pooler configurada en Render.
- [ ] `DB_SSL_REQUIRE=True`.
- [ ] `USE_SUPABASE_STORAGE=True`.
- [ ] `IS_PRODUCTION=True` y `DEBUG=False`.
- [ ] `ALLOWED_HOSTS` con el dominio de Render.
- [ ] `CORS_ALLOWED_ORIGINS` con el dominio de Cloudflare Pages.
- [ ] `CSRF_TRUSTED_ORIGINS` con backend y frontend.
- [ ] `VITE_API_URL` con la URL completa del backend.
- [ ] `dist/_redirects` presente tras el build.
- [ ] Migraciones aplicadas solo con autorización.
- [ ] Superusuario creado.
- [ ] API pública respondiendo.
- [ ] Imágenes subidas, reemplazadas y eliminadas correctamente.
- [ ] Webhook genérico de pedidos validando `X-Webhook-Token`.

---

## 15. Problemas comunes

| Síntoma | Causa probable | Solución |
| --- | --- | --- |
| `DisallowedHost` | Host no incluido | Agrega el dominio a `ALLOWED_HOSTS` |
| Error CORS | Origen con barra final o esquema incorrecto | Usa `https://dominio` exacto |
| Error CSRF en admin | Origen no confiable | Agrega el dominio a `CSRF_TRUSTED_ORIGINS` |
| Error SSL PostgreSQL | Falta `sslmode` | Usa `?sslmode=require` y `DB_SSL_REQUIRE=True` |
| Timeout de base de datos | Conexión directa IPv6 o pooler incorrecto | Usa Session Pooler en el puerto 5432 |
| Imágenes 404/403 | Bucket privado o URL pública mal formada | Revisa `SUPABASE_STORAGE_PUBLIC_URL` y el bucket |
| Imágenes desaparecen tras reiniciar | `USE_SUPABASE_STORAGE=False` en producción | Actívalo y revisa las credenciales S3 |
| `Missing staticfiles manifest entry` | No se ejecutó `collectstatic` | Usa `bash build.sh` en Render |
| El frontend llama a localhost | Falta `VITE_API_URL` en Cloudflare | Configúrala y vuelve a desplegar |
| Supabase pausado | Inactividad del plan gratuito | Reactiva el proyecto en Supabase |
