DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_catalog.pg_roles WHERE rolname = 'knowletive_app') THEN
    CREATE ROLE knowletive_app WITH LOGIN PASSWORD 'staging_app_secure_pass_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  ELSE
    ALTER ROLE knowletive_app WITH LOGIN PASSWORD 'staging_app_secure_pass_2026' NOSUPERUSER NOCREATEDB NOCREATEROLE;
  END IF;
END $$;

GRANT CONNECT ON DATABASE knowletive_staging TO knowletive_app;
GRANT USAGE ON SCHEMA public TO knowletive_app;
GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO knowletive_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO knowletive_app;

REVOKE UPDATE, DELETE, TRUNCATE ON TABLE "BatchEnrollmentEvent" FROM knowletive_app, PUBLIC;

