# Hosting: one file, or one shared database

The desk's database is SQLite either way. The same script and the same SQL work in both
modes; only `DESK_DB` changes.

| | On this machine | Hosted |
| --- | --- | --- |
| `DESK_DB` | `file:desks/data/desk.db` (the default) | `https://<name>.up.railway.app` |
| For | One person on one machine | Several people or machines, or work that must survive a laptop |
| Needs | Node 22.16+ | The same, plus a token in `desks/.env` |
| Cost | Nothing | A small Railway service, under a dollar a month when idle |

On this machine, the file lives in the main checkout's `desks/data/`. A git worktree of
the project (a parallel agent session, say) uses that same file and the main checkout's
`desks/.env`, unless its own `desks/.env` says otherwise. `doctor` shows which file is in
use.

Start on the machine. Move to hosted when a second person or machine joins: the
database comes with you (Moving, below).

## Hosted, on Railway

The hosted database is [libsql-server](https://github.com/tursodatabase/libsql) (`sqld`),
an open-source SQLite server, run as one Railway service with a volume. The
[Hosted SQLite (libSQL)](https://railway.com/deploy/hosted-sqlite-libsql) template sets it
up in one step:

- the image, pinned to the build the kit was tested with;
- standalone mode, so there's no replication port;
- a volume, a healthcheck and a public https address;
- a token made at deploy and required from the first request.

There are no accounts in it. The token lets the script in, and each person still writes
as their own `DESK_USER`.

Ask before creating anything on Railway: which workspace and project it goes in, and say
it adds a small monthly cost. Put it in the business's existing Railway project if it has
one.

`railway deploy` only works in a folder linked to a project. Link an empty folder for it,
not the project repo, which may already be linked to one of its apps:

```sh
cd "$(mktemp -d)" && railway link --workspace "<workspace>" --project <project-id> --environment production
railway deploy -t hosted-sqlite-libsql
cd -
```

That adds a service called `libsql`. A business with no Railway project yet can use the
template's page instead, which deploys it into a new project.

Then fetch the address and token into `desks/.env` as in Adding a person, and run
`node desks/desk.mjs doctor && node desks/desk.mjs init`. `doctor` should show
"connected" and the server's SQLite version. A 401 means the token in `desks/.env` isn't
the service's current one.

Services set up before the template are called `desks`. They check a JWT against
`SQLD_AUTH_JWT_KEY` and keep it in `DESK_DB_TOKEN`. The script handles both kinds, and so
do the commands below.

The kit's tests can run against a hosted database. Point them at a separate, empty one,
because they wipe it:
`DESK_TEST_URL=https://... DESK_TEST_TOKEN=... node --test test/desk.test.mjs` in the kit repo.

The image stays pinned. To move to a newer `sqld`, first run the kit's tests against a
throwaway deploy on the new image. Then change `source.image` on the real one, after
taking a dump.

## Adding a person or machine

Anyone with access to the Railway project fetches the address and token themselves,
straight into their `desks/.env`, so the token never passes through a chat. Use the
service's name (`libsql`, or `desks` for an older one) and its environment, usually
`production`.

```sh
railway variable list --service libsql --project <project-id> --environment production --json | node -e '
  let s = ""; process.stdin.on("data", (d) => (s += d)).on("end", () => {
    const v = JSON.parse(s);
    console.log(`DESK_DB=${v.LIBSQL_URL ?? `https://${v.RAILWAY_PUBLIC_DOMAIN}`}\nDESK_DB_TOKEN=${v.LIBSQL_AUTH_TOKEN ?? v.DESK_DB_TOKEN}`);
  })' >> desks/.env
```

Without Railway access, someone gives them those two lines through something private (a
password manager or Signal), never git or a group chat. Either way, they add their own
`DESK_USER=<name>` and run `doctor`.

## Changing the token

If a token may have leaked, or someone leaves:

```sh
openssl rand -hex 24 | tr -d '\n' \
  | railway variable set LIBSQL_AUTH_TOKEN --stdin --service libsql --project <project-id> --environment production
```

For an older `desks` service, make a new key pair instead:

```sh
node desks/desk.mjs token --json > desks/data/token.json
node -e 'process.stdout.write(require("./desks/data/token.json").DESK_DB_TOKEN)' \
  | railway variable set DESK_DB_TOKEN --stdin --skip-deploys --service desks --project <project-id> --environment production
railway variable set "SQLD_AUTH_JWT_KEY=$(node -p 'require("./desks/data/token.json").SQLD_AUTH_JWT_KEY')" \
  --service desks --project <project-id> --environment production
rm desks/data/token.json
```

Either way the service redeploys, and the old token stops working. Remove the old
`DESK_DB` and `DESK_DB_TOKEN` lines from `desks/.env` and fetch them again. Everyone else
who should keep access does the same, or gets the new lines privately.

## Backups

```sh
node desks/desk.mjs dump desks/data/backups/desk-$(date +%F).sql
```

A dump holds everything: the tables, the rows and the log. It works the same for both
modes. Keep dumps private: they contain people, addresses and drafts. Railway can also
back up the volume; turn that on in the service's settings if the plan allows it. Take a
dump before any risky change (a kit update with migrations, a big import).

## Moving

From this machine to hosted (or back, or between servers):

1. Stop work on the old database: nobody should be mid-send.
2. `node desks/desk.mjs dump desks/data/move.sql` while `desks/.env` still points at the
   old one.
3. Point `desks/.env` at the new one: set `DESK_DB`, plus `DESK_DB_TOKEN` when hosted.
4. `node desks/desk.mjs restore desks/data/move.sql`.
5. Point everyone else's `desks/.env` at the new one.

`restore` loads only into an empty database, then runs `init` to rebuild the views and
triggers.
