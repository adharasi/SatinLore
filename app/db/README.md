# Persistence boundary

The scaffold does not create a database. The planned single-server beta uses SQLite
for invitations, users, sessions, private feedback and reward entitlements.

Add versioned migrations and database-consistent backup/restore checks with that
milestone. Keep the database outside the served static directory and outside Git.
Never store story bodies, filenames, QR payloads or developer credentials here.
See `docs/development-spec.md` for the intended minimal records and constraints.
