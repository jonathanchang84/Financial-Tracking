# pwa/ — legacy standalone app (superseded)

**This app is superseded by [`../financial-dashboard-pwa/`](../financial-dashboard-pwa/).** That is the
live one: it is what runs on Cloudflare Workers, what is signed into, and what syncs to the database.

It is kept because two things still originate here, and neither is captured anywhere else:

- **The IndexedDB schema.** `src/services/indexedDB.js` opens `financial-health-local` at **version 2**,
  a schema this app created. Its lineage is why the native app can open a database that existed before
  it, and why the version number cannot be lowered.
- **The backup JSON format.** `src/services/backup.js` documents that import/export round-trips with this
  prototype using the same `format` string. Changing one without the other would break restore across them.

## Why it is not deleted

- It is a documented deliverable: the root `README.md` explains serving this folder over HTTPS and adding
  it to an iPhone home screen.
- The schema and backup-format lineage above depend on it existing as a reference.
- **No user data lives here.** Data is in the browser's IndexedDB, not in this folder, so deleting the
  files cannot destroy anyone's records.

## Do not extend it

`app.js` still reads `settings.payday`, which is no longer how paydays are modelled — `app.js` predates
the income-streams change and the Worker-owned authentication. Anything new belongs in
`financial-dashboard-pwa/`.

⚠️ **Never serve this folder from the same origin as the Svelte app.** Both use the database name
`financial-health-local`, and IndexedDB is origin-scoped: on one origin they would share data, and this
app would write a `payday` shape the live app no longer reads. Served from a different origin or a
different port, they are independent and it is safe to run side by side.

## Running it locally

```bash
cd pwa && python3 -m http.server 8080
```

No build step and no dependencies — four static files. The service worker needs `https://` or
`localhost`, so `localhost` works; installing to an iPhone home screen needs real HTTPS hosting.
