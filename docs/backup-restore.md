# Knowletive SaaS - Database & Asset Backup / Disaster Recovery Guide

## 1. Zero-Cost Backup Architecture
Backups are performed using native PostgreSQL client tools (`pg_dump`) and standard Linux utilities (`gzip`, `gpg`, `tar`). Zero cloud subscriptions or paid backup services are required.

### What is Backed Up:
1. **PostgreSQL Database (`knowletive`):** Full relational schema, tenant data, user accounts, audit logs, and transaction tables.
2. **Local Persistent Storage Assets (`/app/.data/uploads`):** Student photos, admission files, and institute documents.

---

## 2. Automated Daily Backup Execution

The backup script is located at:
`scripts/backup.sh`

### Configuration Environment Variables:
- `BACKUP_DIR`: Directory where backups are written (Default: `/var/backups/knowletive`).
- `DB_CONTAINER`: Docker container name (Default: `knowletive-db`).
- `DB_NAME`: Database name (Default: `knowletive`).
- `DB_USER`: PostgreSQL user (Default: `knowletive`).
- `RETENTION_DAYS`: Number of days to retain backups on VPS (Default: `14`).
- `ENCRYPTION_KEY_FILE`: Path to AES-256 key file (Optional: `/etc/knowletive/backup.key`).

### Setting up Scheduled Cron on Hostinger VPS:
Open crontab:
```bash
sudo crontab -e
```
Add the daily 2:00 AM backup schedule:
```cron
0 2 * * * /path/to/knowletive/scripts/backup.sh >> /var/log/knowletive-backup.log 2>&1
```

---

## 3. Off-Site Backup Procedure (Zero Additional Cost)

> [!WARNING]
> Keeping backups exclusively on the Hostinger VPS does NOT protect against full VPS termination, datacenter failure, or account suspension.

To guarantee complete disaster recovery without paid cloud storage, pull backups to your local workstation or offline drive weekly using **Secure Copy (`scp`)**:

### From your local workstation (macOS / Linux / Windows PowerShell):
```bash
# Copy the latest database backup to your local hard drive
scp user@your-vps-ip:/var/backups/knowletive/db/*.sql.gz ./local-backups/
```

Alternatively, use an automated cron/task on your personal machine to sync via `rsync`:
```bash
rsync -avz -e "ssh -i ~/.ssh/id_rsa" user@your-vps-ip:/var/backups/knowletive/ ~/OfflineBackups/Knowletive/
```

---

## 4. Test Restoration Procedure (Isolated Environment)

Never execute a test restoration directly over your live production database.

### Step 1: Create a Temporary Staging Database
```bash
docker exec -it knowletive-db psql -U postgres -c "CREATE DATABASE knowletive_test OWNER knowletive;"
```

### Step 2: Run Restoration Script
```bash
./scripts/restore.sh /var/backups/knowletive/db/knowletive_20261105.sql.gz knowletive_test
```

### Step 3: Verify Staging Data
```bash
docker exec -it knowletive-db psql -U knowletive -d knowletive_test -c "SELECT count(*) FROM \"Student\";"
docker exec -it knowletive-db psql -U knowletive -d knowletive_test -c "SELECT count(*) FROM \"Tenant\";"
```

### Step 4: Tear Down Staging Database
```bash
docker exec -it knowletive-db psql -U postgres -c "DROP DATABASE knowletive_test;"
```

