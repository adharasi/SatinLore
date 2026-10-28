# External service boundary

`lovense.py` exchanges the server-held developer token for a token belonging to the
authenticated random SatinLore user ID. The endpoint is fixed, redirects are disabled,
timeout is eight seconds and the response size is bounded. Provider errors are replaced
with a generic message. Tokens are neither cached in SQLite nor written to logs.

The browser receives its individual vendor token; never send the developer token.
Application logout revokes the SatinLore session. It does not promise remote revocation
of a token already issued by Lovense; the browser must stop and destroy its SDK instance.
