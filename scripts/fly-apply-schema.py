#!/usr/bin/env python3
"""Apply the repository desired-state schema from a Fly release machine."""

import os
import subprocess
import sys
from pathlib import Path
from urllib.parse import parse_qs, unquote, urlsplit


SCHEMA_DIR = Path("/opt/buzz/schema")
SCHEMA_FILE = SCHEMA_DIR / "schema.sql"
RECONCILE_FILE = SCHEMA_DIR / "reconcile-schema-after-pgschema.sql"


def connection_environment() -> dict[str, str]:
    database_url = os.environ.get("DATABASE_URL", "")
    try:
        parsed = urlsplit(database_url)
        port = parsed.port or 5432
    except ValueError:
        raise SystemExit("DATABASE_URL is not a valid Postgres URL") from None

    database = unquote(parsed.path.lstrip("/"))
    user = unquote(parsed.username or "")
    if parsed.scheme not in {"postgres", "postgresql"} or not all(
        (parsed.hostname, user, database)
    ):
        raise SystemExit("DATABASE_URL must contain a Postgres host, user, and database")

    env = {
        "PATH": os.environ.get("PATH", "/usr/local/bin:/usr/bin:/bin"),
        "HOME": os.environ.get("HOME", "/var/lib/buzz"),
    }
    for name in ("LANG", "LC_ALL"):
        if name in os.environ:
            env[name] = os.environ[name]
    env.update(
        {
            "PGHOST": parsed.hostname or "",
            "PGPORT": str(port),
            "PGUSER": user,
            "PGDATABASE": database,
        }
    )
    if parsed.password is None:
        env.pop("PGPASSWORD", None)
    else:
        env["PGPASSWORD"] = unquote(parsed.password)

    libpq_query_options = {
        "sslmode": "PGSSLMODE",
        "sslrootcert": "PGSSLROOTCERT",
        "sslcert": "PGSSLCERT",
        "sslkey": "PGSSLKEY",
        "connect_timeout": "PGCONNECT_TIMEOUT",
        "application_name": "PGAPPNAME",
        "options": "PGOPTIONS",
        "target_session_attrs": "PGTARGETSESSIONATTRS",
        "channel_binding": "PGCHANNELBINDING",
        "gssencmode": "PGGSSENCMODE",
        "keepalives": "PGKEEPALIVES",
        "keepalives_idle": "PGKEEPALIVESIDLE",
        "keepalives_interval": "PGKEEPALIVESINTERVAL",
        "keepalives_count": "PGKEEPALIVESCOUNT",
        "tcp_user_timeout": "PGTCPUSERTO",
    }
    query = parse_qs(parsed.query, keep_blank_values=True)
    for url_key, env_key in libpq_query_options.items():
        values = query.get(url_key, [])
        if len(values) > 1:
            raise SystemExit(f"DATABASE_URL repeats the {url_key} option")
        if values:
            env[env_key] = values[0]

    plan_values = {
        "PGSCHEMA_PLAN_HOST": env["PGHOST"],
        "PGSCHEMA_PLAN_PORT": env["PGPORT"],
        "PGSCHEMA_PLAN_DB": env["PGDATABASE"],
        "PGSCHEMA_PLAN_USER": env["PGUSER"],
    }
    if "PGPASSWORD" in env:
        plan_values["PGSCHEMA_PLAN_PASSWORD"] = env["PGPASSWORD"]
    else:
        env.pop("PGSCHEMA_PLAN_PASSWORD", None)
    env.update(plan_values)
    return env


def main() -> int:
    if not SCHEMA_FILE.is_file() or not RECONCILE_FILE.is_file():
        print("Fly schema files are missing from the canary image", file=sys.stderr)
        return 1

    env = connection_environment()
    print("Applying schema/schema.sql with pgschema.")
    subprocess.run(
        [
            "/usr/local/bin/pgschema",
            "apply",
            "--file",
            str(SCHEMA_FILE),
            "--auto-approve",
        ],
        check=True,
        env=env,
    )
    print("Applying scripts/reconcile-schema-after-pgschema.sql.")
    subprocess.run(
        [
            "/usr/bin/psql",
            "--no-psqlrc",
            "--dbname",
            env["PGDATABASE"],
            "--set=ON_ERROR_STOP=1",
            "--file",
            str(RECONCILE_FILE),
        ],
        check=True,
        env=env,
    )
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
