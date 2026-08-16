# Duckworth three-profile local runtime

Duckworth deliberately has no global profile switch. Family members keep using family-live while development uses sandbox and automated tests receive a new disposable API-test instance for every run.

| Profile | Lifetime | Web URL | API | Data |
|---|---|---|---|---|
| family-live | Continuous | `http://<LAN-IP>:4200/` | `127.0.0.1:3000` | `%LOCALAPPDATA%\Duckworth\data\live\duckworth.sqlite` |
| sandbox | Continuous | `http://<LAN-IP>:4300/` | `127.0.0.1:3001` | `%LOCALAPPDATA%\Duckworth\data\sandbox\duckworth.sqlite` |
| API-test | Per command | Optional dynamic loopback URL | Dynamic loopback port | Unique temporary SQLite database |

Only ports 4200 and 4300 are exposed to the private LAN. APIs stay on loopback and the API-test profile can never bind to the LAN.

## First-time setup

Run these commands from the repository root. Set `DUCKWORTH_LAN_HOST` when automatic adapter selection does not choose the address used by phones.

```powershell
$env:DUCKWORTH_LAN_HOST = '192.168.0.102'
node tools/lanes/duckworth-profiles.mjs bootstrap live --household household-demo
node tools/lanes/duckworth-profiles.mjs release promote
node tools/lanes/duckworth-profiles.mjs ensure
node tools/lanes/duckworth-profiles.mjs startup install
node tools/lanes/duckworth-profiles.mjs firewall install
```

The bootstrap command prints a time-bounded pairing code but never prints the live access token. Every family device may use that code during its pairing window; each receives a persistent HttpOnly session cookie. Credentials are written outside the repository to `%LOCALAPPDATA%\Duckworth\config\live.env` and restricted to the current Windows user. If the file already exists, bootstrap refuses to overwrite it.

`firewall install` requires an elevated terminal. It creates private-network, local-subnet rules only for web ports 4200 and 4300.

`startup install` first tries a limited Task Scheduler logon task. If Windows denies task creation for the current account, it installs an equivalent hidden per-user Startup-folder launcher. `startup status` recognizes either method.

## Daily use

```powershell
# Start missing or unhealthy permanent processes; keep healthy ones untouched.
node tools/lanes/duckworth-profiles.mjs ensure

# Restart only sandbox. Family-live is not stopped.
node tools/lanes/duckworth-profiles.mjs restart sandbox

# Inspect runtime health, source roots, URLs and port owners.
node tools/lanes/duckworth-profiles.mjs diagnose

# Inspect boot and firewall setup.
node tools/lanes/duckworth-profiles.mjs startup status
node tools/lanes/duckworth-profiles.mjs firewall status
```

The PowerShell compatibility wrapper remains available:

```powershell
.\tools\lanes\duckworth-lanes.ps1 start
.\tools\lanes\duckworth-lanes.ps1 restart sandbox
.\tools\lanes\duckworth-lanes.ps1 status
```

Sandbox and API-test display conspicuous warnings. Family-live intentionally has no testing banner.

## Automated and manual API testing

Run a test command inside a disposable API-test instance:

```powershell
node tools/lanes/duckworth-profiles.mjs api-test run -- pnpm --dir duckworth-api test
```

The child command receives:

- `DUCKWORTH_API_TEST_ORIGIN`
- `DUCKWORTH_API_TEST_INSTANCE_ID`
- `DUCKWORTH_API_TEST_LEASE`

The API rejects mutations without the instance-bound lease. Family-live never issues this lease. The process and database are removed whether the test passes, fails, or is interrupted.

Browser mutation checks use the same disposable boundary:

```powershell
node tools/lanes/duckworth-profiles.mjs api-test run --with-web -- `
  python duckworth-web/e2e/foundation_check.py
```

`--with-web` serves the built web application on another dynamic loopback port and injects the lease only inside its local reverse proxy. The child receives `DUCKWORTH_API_TEST_WEB_ORIGIN` plus the E2E target variables. The browser cannot accidentally mutate family-live or persistent sandbox data.

For manual API inspection, open a time-bounded instance:

```powershell
node tools/lanes/duckworth-profiles.mjs api-test open --with-web --ttl 30m
```

The command prints the local URL and removes the instance on expiry or Ctrl+C. Orphaned expired instances can be reaped with `api-test reap`.

## Live release promotion

Family-live runs built artifacts from an immutable release directory; it never runs `tsx watch` or `ng serve`. Sandbox continues to run the development worktree.

```powershell
node tools/lanes/duckworth-profiles.mjs release promote
```

Promotion performs this sequence:

1. Build API and web artifacts.
2. Create an integrity-checked live backup when a live database exists.
3. Verify and dry-run the backup.
4. Deploy an immutable API package and built web application to a staging directory.
5. Atomically activate the release marker.
6. Restart only family-live.
7. Verify the exact live instance and build identity through the user-visible web origin.

If post-activation verification fails, the previous release marker is restored and family-live is restarted from that release. With local SQLite, a release has a short controlled maintenance window; normal sandbox development does not interrupt live.

## Database backup and restore drill

```powershell
pnpm --dir duckworth-api maintenance:database -- backup `
  "$env:LOCALAPPDATA\Duckworth\data\live\duckworth.sqlite" `
  "$env:LOCALAPPDATA\Duckworth\backups\manual-live.sqlite" `
  --lane live --instance family-live

pnpm --dir duckworth-api maintenance:database -- verify `
  "$env:LOCALAPPDATA\Duckworth\backups\manual-live.sqlite"

pnpm --dir duckworth-api maintenance:database -- restore-drill `
  "$env:LOCALAPPDATA\Duckworth\backups\manual-live.sqlite" `
  "$env:LOCALAPPDATA\Duckworth\data\restore-drills\manual-live.sqlite"
```

Restore drills only create a new path. They never overwrite an existing database.

## Diagnosis and recovery

Operational state, bounded rotating logs, releases and data are under `%LOCALAPPDATA%\Duckworth`, not a Git worktree. `diagnose` reports any process already owning ports 3000, 3001, 4200 or 4300, including its PID and command line. The supervisor validates its hosted key and fingerprint before stopping a PID, preventing an unrelated process from being terminated after PID reuse.

If a permanent process crashes, the resident supervisor retries with capped exponential backoff. To remove automatic startup or LAN rules:

```powershell
node tools/lanes/duckworth-profiles.mjs startup remove
node tools/lanes/duckworth-profiles.mjs firewall remove
```

Never delete or replace `%LOCALAPPDATA%\Duckworth\data\live` during recovery. Verify a backup and restore it to a new drill path first.
