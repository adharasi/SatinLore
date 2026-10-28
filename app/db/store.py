"""Minimal SQLite invitation/session store. No names, stories or raw access tokens."""
from contextlib import contextmanager
from hashlib import sha256
from pathlib import Path
import secrets
import sqlite3
import time
import uuid


def digest(value: str) -> str:
    return sha256(value.encode("utf-8")).hexdigest()


def csrf_for(session_token: str) -> str:
    return digest("satinlore-csrf:" + session_token)


class Store:
    def __init__(self, path: Path, clock=time.time):
        self.path = Path(path)
        self.clock = clock

    @contextmanager
    def connection(self):
        self.path.parent.mkdir(parents=True, exist_ok=True)
        connection = sqlite3.connect(self.path, timeout=5, isolation_level=None)
        connection.row_factory = sqlite3.Row
        connection.execute("PRAGMA foreign_keys = ON")
        connection.executescript("""
            CREATE TABLE IF NOT EXISTS beta_users (
                id TEXT PRIMARY KEY, created_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS invites (
                token_hash TEXT PRIMARY KEY, expires_at INTEGER NOT NULL,
                redeemed_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS sessions (
                token_hash TEXT PRIMARY KEY,
                user_id TEXT NOT NULL REFERENCES beta_users(id) ON DELETE CASCADE,
                expires_at INTEGER NOT NULL
            );
            CREATE TABLE IF NOT EXISTS rate_limits (
                key_hash TEXT PRIMARY KEY, window_start INTEGER NOT NULL,
                attempts INTEGER NOT NULL
            );
        """)
        try:
            yield connection
        finally:
            connection.close()

    def create_invite(self, ttl_seconds=86400):
        if not 60 <= ttl_seconds <= 604800:
            raise ValueError("Invite lifetime must be 60 seconds to 7 days.")
        token = secrets.token_urlsafe(32)
        now = int(self.clock())
        with self.connection() as db:
            db.execute("INSERT INTO invites VALUES (?, ?, NULL)", (digest(token), now + ttl_seconds))
            self._prune(db, now)
        return token

    def redeem(self, invite_token: str, session_ttl: int):
        now = int(self.clock())
        token = secrets.token_urlsafe(32)
        user_id = uuid.uuid4().hex
        expires_at = now + session_ttl
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                changed = db.execute(
                    "UPDATE invites SET redeemed_at=? WHERE token_hash=? AND redeemed_at IS NULL AND expires_at>?",
                    (now, digest(invite_token), now),
                ).rowcount
                if not changed:
                    db.rollback()
                    return None
                db.execute("INSERT INTO beta_users VALUES (?, ?)", (user_id, now))
                db.execute("INSERT INTO sessions VALUES (?, ?, ?)", (digest(token), user_id, expires_at))
                self._prune(db, now)
                db.commit()
            except BaseException:
                db.rollback()
                raise
        return {"token": token, "user_id": user_id, "expires_at": expires_at}

    def session(self, token: str):
        with self.connection() as db:
            row = db.execute(
                "SELECT user_id, expires_at FROM sessions WHERE token_hash=? AND expires_at>?",
                (digest(token), int(self.clock())),
            ).fetchone()
            return dict(row) if row else None

    def revoke(self, token: str):
        with self.connection() as db:
            db.execute("DELETE FROM sessions WHERE token_hash=?", (digest(token),))

    def allow(self, key: str, limit: int, window_seconds: int):
        now = int(self.clock())
        key_hash = digest(key)
        with self.connection() as db:
            db.execute("BEGIN IMMEDIATE")
            try:
                row = db.execute("SELECT * FROM rate_limits WHERE key_hash=?", (key_hash,)).fetchone()
                if row is None or now >= row["window_start"] + window_seconds:
                    db.execute("INSERT OR REPLACE INTO rate_limits VALUES (?, ?, 1)", (key_hash, now))
                    allowed = True
                elif row["attempts"] >= limit:
                    allowed = False
                else:
                    db.execute("UPDATE rate_limits SET attempts=attempts+1 WHERE key_hash=?", (key_hash,))
                    allowed = True
                self._prune(db, now)
                db.commit()
            except BaseException:
                db.rollback()
                raise
        return allowed

    @staticmethod
    def _prune(db, now):
        db.execute("DELETE FROM sessions WHERE expires_at<=?", (now,))
        db.execute("DELETE FROM invites WHERE expires_at<=?", (now,))
        db.execute("DELETE FROM rate_limits WHERE window_start<?", (now - 86400,))
        db.execute("DELETE FROM beta_users WHERE id NOT IN (SELECT user_id FROM sessions)")
