#!/usr/bin/env python3
import base64
import json
import os
import sqlite3
import sys
from dataclasses import dataclass

import keyring
from cryptography.hazmat.backends import default_backend
from cryptography.hazmat.primitives.ciphers import Cipher
from cryptography.hazmat.primitives.ciphers.algorithms import AES
from cryptography.hazmat.primitives.ciphers.modes import CFB8


KEYRING_SERVICE = "pgAdmin4"
KEYRING_MASTER_USER = "pgadmin4-master-password"
KEYRING_SERVER_USER = "pgAdmin4-{name}-{server_id}"
OWN_KEYRING_SERVICE = "proxydiablo"
LEGACY_KEYRING_SERVICE = "pgsqldiablo"
OWN_KEYRING_MASTER_USER = "pgadmin4-master-password"
IV_SIZE = AES.block_size // 8


@dataclass
class Server:
    id: int
    name: str
    host: str | None
    port: int | None
    maintenance_db: str | None
    username: str | None
    password: str | None
    save_password: int | None
    service: str | None
    kerberos_conn: int | None
    connection_params: str | None


def emit(data):
    print(json.dumps(data, ensure_ascii=False))


def default_db_path():
    return os.environ.get("PROXYDIABLO_PGADMIN_DB", os.path.join(os.environ["APPDATA"], "pgAdmin", "pgadmin4.db"))


def pgadmin_binary_string(value):
    if isinstance(value, str):
        try:
            return bytes.fromhex(value)
        except Exception:
            return value
    return value


def pad_key(key):
    if isinstance(key, str):
        key = key.encode()
    key = key[:32]
    if len(key) in (16, 24, 32):
        return key
    return key.ljust(32, b"}")


def decrypt(ciphertext, key):
    ciphertext = pgadmin_binary_string(ciphertext)
    raw = base64.b64decode(ciphertext)
    iv = raw[:IV_SIZE]
    decryptor = Cipher(AES(pad_key(key)), CFB8(iv), default_backend()).decryptor()
    return decryptor.update(raw[IV_SIZE:]) + decryptor.finalize()


def connect_db():
    con = sqlite3.connect(f"file:{default_db_path()}?mode=ro", uri=True)
    con.row_factory = sqlite3.Row
    return con


def load_user(con):
    row = con.execute("select id, email, password, masterpass_check from user limit 1").fetchone()
    if not row:
        raise SystemExit("No pgAdmin user found")
    return row


def load_servers(con):
    rows = con.execute(
        """
        select id, name, host, port, maintenance_db, username, password,
               save_password, service, kerberos_conn, connection_params
        from server
        where coalesce(is_adhoc, 0) = 0
        order by lower(name), id
        """
    ).fetchall()
    return [Server(**dict(row)) for row in rows]


def keyring_password_for_server(server):
    key_name = KEYRING_SERVER_USER.format(name=server.name, server_id=server.id)
    try:
        return keyring.get_password(KEYRING_SERVICE, key_name)
    except Exception:
        return None


def automatic_candidate_keys(user):
    candidates = []
    env_key = os.environ.get("PROXYDIABLO_MASTER_PASSWORD")
    if env_key:
        candidates.append(env_key)
    for service, username in (
        (OWN_KEYRING_SERVICE, OWN_KEYRING_MASTER_USER),
        (LEGACY_KEYRING_SERVICE, OWN_KEYRING_MASTER_USER),
        (KEYRING_SERVICE, KEYRING_MASTER_USER),
    ):
        try:
            value = keyring.get_password(service, username)
        except Exception:
            value = None
        if value:
            candidates.append(value)
    if user["password"]:
        candidates.append(pgadmin_binary_string(user["password"]))
    return candidates


def decrypt_server_password(server, user):
    if not server.password:
        return keyring_password_for_server(server)
    keyring_password = keyring_password_for_server(server)
    if keyring_password:
        return keyring_password
    for key in automatic_candidate_keys(user):
        try:
            return decrypt(server.password, key).decode("utf-8")
        except Exception:
            pass
    raise SystemExit("Cannot decrypt saved password for selected profile")


def select_server(servers, selector):
    if selector.isdigit():
        for server in servers:
            if server.id == int(selector):
                return server
    wanted = selector.casefold()
    exact = [s for s in servers if s.name.casefold() == wanted]
    if len(exact) == 1:
        return exact[0]
    partial = [s for s in servers if wanted in s.name.casefold()]
    if len(partial) == 1:
        return partial[0]
    if not partial:
        raise SystemExit(f"No profile matches {selector!r}")
    raise SystemExit("Several profiles match; use exact name or id")


def parse_connection_params(raw):
    if not raw:
        return {}
    try:
        data = json.loads(raw)
    except Exception:
        return {}
    return data if isinstance(data, dict) else {}


def list_profiles():
    con = connect_db()
    try:
        servers = load_servers(con)
    finally:
        con.close()
    emit(
        {
            "profiles": [
                {
                    "id": s.id,
                    "name": s.name,
                    "host": s.host or s.service,
                    "port": s.port,
                    "username": s.username,
                    "maintenanceDb": s.maintenance_db,
                }
                for s in servers
            ]
        }
    )


def resolve(profile, database):
    con = connect_db()
    try:
        user = load_user(con)
        servers = load_servers(con)
    finally:
        con.close()
    server = select_server(servers, profile)
    password = decrypt_server_password(server, user)
    params = parse_connection_params(server.connection_params)
    emit(
        {
            "id": server.id,
            "name": server.name,
            "host": server.host,
            "port": server.port,
            "database": database or server.maintenance_db or "postgres",
            "user": server.username,
            "password": password,
            "sslmode": params.get("sslmode"),
            "connect_timeout": params.get("connect_timeout"),
            "service": server.service,
        }
    )


def main():
    if len(sys.argv) < 2:
        raise SystemExit("usage: list | resolve PROFILE DATABASE")
    if sys.argv[1] == "list":
        list_profiles()
        return
    if sys.argv[1] == "resolve":
        if len(sys.argv) < 4:
            raise SystemExit("usage: resolve PROFILE DATABASE")
        resolve(sys.argv[2], sys.argv[3])
        return
    raise SystemExit(f"unknown command: {sys.argv[1]}")


if __name__ == "__main__":
    main()
