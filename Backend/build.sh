#!/usr/bin/env bash

set -o errexit
set -o pipefail
set -o nounset

python -m pip install --upgrade pip
python -m pip install -r requirements.txt

python manage.py collectstatic --noinput

# Las migraciones NO se ejecutan automáticamente.
# Deben autorizarse y ejecutarse manualmente (ver DEPLOYMENT.md).
