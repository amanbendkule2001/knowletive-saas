#!/usr/bin/env bash
# ==============================================================================
# Knowletive SaaS - Zero-Additional-Cost Database & Asset Backup Script
# Usage: ./scripts/backup.sh
# Cron example (run daily at 2:00 AM):
# 0 2 * * * /path/to/knowletive/scripts/backup.sh >> /var/log/knowletive-backup.log 2>&1
# ==============================================================================

set -euo pipefail

BACKUP_DIR="${BACKUP_DIR:-/var/backups/knowletive}"
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")
DB_CONTAINER="${DB_CONTAINER:-knowletive-db}"
DB_NAME="${DB_NAME:-knowletive}"
DB_USER="${DB_USER:-knowletive}"
UPLOADS_DIR="${UPLOADS_DIR:-/app/.data/uploads}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
ENCRYPTION_KEY_FILE="${ENCRYPTION_KEY_FILE:-/etc/knowletive/backup.key}"

mkdir -p "$BACKUP_DIR/db"
mkdir -p "$BACKUP_DIR/assets"

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Starting Knowletive backup..."

# 1. PostgreSQL Database Dump (Compressed)
DB_BACKUP_FILE="${BACKUP_DIR}/db/${DB_NAME}_${TIMESTAMP}.sql.gz"
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Dumping database '${DB_NAME}' from container '${DB_CONTAINER}'..."

if command -v docker >/dev/null 2>&1 && docker ps --format '{{.Names}}' | grep -q "^${DB_CONTAINER}$"; then
  docker exec -t "${DB_CONTAINER}" pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip > "${DB_BACKUP_FILE}"
elif command -v pg_dump >/dev/null 2>&1; then
  pg_dump -U "${DB_USER}" -d "${DB_NAME}" --clean --if-exists | gzip > "${DB_BACKUP_FILE}"
else
  echo "ERROR: Neither docker nor pg_dump was found to dump the database." >&2
  exit 1
fi

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Database dump completed: ${DB_BACKUP_FILE} ($(du -h "${DB_BACKUP_FILE}" | cut -f1))"

# 2. Asset / Uploaded Documents Backup (if directory exists and contains files)
if [ -d "${UPLOADS_DIR}" ] && [ "$(ls -A "${UPLOADS_DIR}" 2>/dev/null)" ]; then
  ASSET_BACKUP_FILE="${BACKUP_DIR}/assets/assets_${TIMESTAMP}.tar.gz"
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Archiving uploaded documents from ${UPLOADS_DIR}..."
  tar -czf "${ASSET_BACKUP_FILE}" -C "${UPLOADS_DIR}" .
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Asset backup completed: ${ASSET_BACKUP_FILE} ($(du -h "${ASSET_BACKUP_FILE}" | cut -f1))"
fi

# 3. Optional AES-256 GPG Encryption (if keyfile exists)
if [ -f "${ENCRYPTION_KEY_FILE}" ]; then
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Encrypting database backup with AES-256..."
  gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "${ENCRYPTION_KEY_FILE}" "${DB_BACKUP_FILE}"
  rm -f "${DB_BACKUP_FILE}"
  echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Encrypted database file: ${DB_BACKUP_FILE}.gpg"

  if [ -n "${ASSET_BACKUP_FILE:-}" ] && [ -f "${ASSET_BACKUP_FILE}" ]; then
    gpg --batch --yes --symmetric --cipher-algo AES256 --passphrase-file "${ENCRYPTION_KEY_FILE}" "${ASSET_BACKUP_FILE}"
    rm -f "${ASSET_BACKUP_FILE}"
    echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Encrypted assets file: ${ASSET_BACKUP_FILE}.gpg"
  fi
fi

# 4. Retention Policy - Remove backups older than RETENTION_DAYS
echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Enforcing ${RETENTION_DAYS}-day retention policy..."
find "${BACKUP_DIR}/db" -type f -mtime +"${RETENTION_DAYS}" -delete
find "${BACKUP_DIR}/assets" -type f -mtime +"${RETENTION_DAYS}" -delete

echo "[$(date -u +"%Y-%m-%dT%H:%M:%SZ")] Backup process completed successfully."

