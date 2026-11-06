#!/usr/bin/env bash
# ==============================================================================
# Knowletive SaaS - Database & Asset Restoration Script
# Usage: ./scripts/restore.sh <backup_file.sql.gz[.gpg]> [target_db_name]
# WARNING: This overwrites target database tables. Never test directly on production.
# ==============================================================================

set -euo pipefail

BACKUP_FILE="${1:-}"
TARGET_DB="${2:-knowletive_test}"
DB_CONTAINER="${DB_CONTAINER:-knowletive-db}"
DB_USER="${DB_USER:-knowletive}"
ENCRYPTION_KEY_FILE="${ENCRYPTION_KEY_FILE:-/etc/knowletive/backup.key}"

if [ -z "${BACKUP_FILE}" ] || [ ! -f "${BACKUP_FILE}" ]; then
  echo "Usage: $0 <path_to_backup_file> [target_db_name]" >&2
  exit 1
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Preparing restoration of '${BACKUP_FILE}' into '${TARGET_DB}'..."

TEMP_SQL="/tmp/restore_$$.sql"
trap 'rm -f "${TEMP_SQL}"' EXIT

# 1. Decrypt if GPG encrypted
if [[ "${BACKUP_FILE}" == *.gpg ]]; then
  if [ ! -f "${ENCRYPTION_KEY_FILE}" ]; then
    echo "ERROR: Backup is encrypted but keyfile '${ENCRYPTION_KEY_FILE}' was not found." >&2
    exit 1
  fi
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Decrypting GPG archive..."
  gpg --batch --quiet --decrypt --passphrase-file "${ENCRYPTION_KEY_FILE}" "${BACKUP_FILE}" | gunzip > "${TEMP_SQL}"
elif [[ "${BACKUP_FILE}" == *.gz ]]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Decompressing gzip archive..."
  gunzip -c "${BACKUP_FILE}" > "${TEMP_SQL}"
else
  cat "${BACKUP_FILE}" > "${TEMP_SQL}"
fi

# 2. Execute restoration into target DB
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Restoring into '${TARGET_DB}'..."
if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  docker exec -i "${DB_CONTAINER}" psql -U "${DB_USER}" -d "${TARGET_DB}" < "${TEMP_SQL}"
elif command -v psql >/dev/null 2>&1; then
  psql -U "${DB_USER}" -d "${TARGET_DB}" < "${TEMP_SQL}"
else
  echo "ERROR: Neither docker nor psql was found to restore the database." >&2
  exit 1
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Restoration into '${TARGET_DB}' completed successfully."

