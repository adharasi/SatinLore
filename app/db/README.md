# Local beta data

`store.py` implements SQLite invitation, session and rate-limit records. Tokens are
stored as SHA-256 hashes. User IDs are random and no names or story text are stored.
Invites are single-use and expire; redemption and session creation are one transaction.

Expired invitations, sessions and daily-old rate buckets are pruned on invite creation,
redemption and rate-limit checks. User records with no remaining session are also removed.
An idle database is not purged automatically; deletion/retention operations for a hosted beta
remain a later milestone. Keep the database outside `app/static` and out of Git.
