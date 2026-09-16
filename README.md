# CordisX Game Room

A multiplayer game platform with a CordisX client, self-hosted authoritative
server, uploadable game packages and personal Agent dispatch.

The lobby brings rooms from multiple servers together. A room pins its author's
game package: the server executes its rules and players receive their own seat's
view. Gomoku and Texas Hold'em are the first example packages; new games use the
same publishing and room APIs.

This repository is under active development. Server and economic integration
have executable checks; the complete native client and uploaded UI runtime are
still being integrated. See the [integration evidence](docs/integration.md) for
the distinction between component tests and a complete application.

## Run a server

With Node.js 24.14 or newer:

```sh
npm ci
npm run build
npm run dev:server
```

The default address is `http://127.0.0.1:8787`. Follow
[self-hosting](docs/server-development.md) for persistent storage, deployment
configuration, TLS and recovery. Each deployment is an independent data source.

Score-only and match-local chips work without an economic service. Shared
entertainment Token coins use the separate
[Economy service](https://github.com/cordisx/plugin-economy), with explicit
stake consent and conserved settlement. These are virtual game coins.

## Develop and extend

| Component | Guide |
| --- | --- |
| CordisX client | [Client development](docs/client.md) |
| HTTP and rule runtime | [Server API and GamePackage v1](docs/server-api.md) |
| Gomoku and Hold'em | [Example games](docs/games.md) |
| Your own game | [Authoring and publishing](docs/games-authoring.md) |
| Personal Agent seats | [Dispatch service](docs/agents.md) |
| Cross-service verification | [Integration checks](docs/integration.md) |

The server, `client/`, `games/` and `agents/` have independent package locks.
Install and build each component from its own directory. The server never
imports uploaded rules as trusted Node modules; resource isolation and game
fairness are separate properties. An author's review status is displayed and
does not prove the rules are fair.

Licensed under [MIT](LICENSE).
