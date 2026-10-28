# Server-side services

Add authenticated invitation/session and vendor-token services here in the next milestone.
Keep HTTP request handling in `app/api/` and persistence in `app/db/`.

The server must derive the Lovense user identity from its own authenticated session.
Developer credentials never reach the browser. No vendor client or authentication is
implemented in this scaffold; the Lovense route deliberately returns HTTP 501.
