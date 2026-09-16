# Node backend deployment

This recipe deploys only the authoritative Game Room HTTP backend. The CordisX
plugin and the existing local wallet remain where they are. This service requires
Node 24.14 or later, persistent SQLite and Node worker threads for its QuickJS
WebAssembly guests. It is not a Sites Workers entrypoint.

## Publish inputs

Keep `package.json`, `package-lock.json`, `tsconfig.json`, `server/`, `sdk/` and
`deploy/` together. The root lockfile references
`sdk/experimental/cordisx-protocol-local-work-settlement-v1.tgz`; include its exact
bytes before installing dependencies. Do not package local databases, credentials,
managed-source trust, `.env` files or an existing wallet profile.

Build and verify the selected source before deployment:

```sh
npm ci
npm run build
npm run test:production
docker build -f deploy/Dockerfile -t game-room:reviewed .
```

The production smoke uses a temporary isolated database and runs the compiled
rule/UI workers, HTTP entrypoint and graceful shutdown. A successful local smoke
does not prove that a container or an online deployment is healthy.

## Smallest deployment

Use the existing `deploy/compose.yaml` on a Node-compatible server. Keep one
service instance against the persistent `game-room-data` volume and put an HTTPS
reverse proxy in front of its loopback port 8787. Configure the clients with that
public service origin. Preserve the volume when updating the service.

Set `AUTH_POLICY` explicitly to `guest-allowed` or `login-required`. The default
requires login. Guest mode enables the existing server-issued guest-session
flow; it does not enroll a Native account. Login mode uses this server's normal
account/session APIs. Do not copy the local Native account trust into a public
deployment. Set `ALLOWED_ORIGINS` to the comma-separated exact browser origins
that may call the API; requests with other Origin headers are rejected.

Leave the `ECONOMY_*` connection values empty for a backend without an online
economy. That deployment supports score-only games and does not connect to the
operator's loopback wallet. Publish the reviewed immutable game packages through
the normal authenticated package API. An empty new service has no game packages
until they are published.

For a non-container deployment, the existing `deploy/game-room.service` starts
`/opt/game-room/dist/server/main.js` with `/etc/game-room.env` and a persistent
database in `/var/lib/game-room`. Install the compiled `dist/server`, `dist/sdk`
and production dependencies together. Configure the bind address, TLS proxy,
authentication policy and origins as above.

After publishing, verify `/health`, `/v1/handshake`, the selected access policy,
package listing, two normal client sessions and persistence across a controlled
restart. Deployment source, container validation and online acceptance are
separate evidence.
