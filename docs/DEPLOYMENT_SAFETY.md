# Deployment Safety

`npm run deploy:vps` keeps the previous release available until the new process
passes every deployment gate.

The remote deployment sequence is:

1. Save a rollback archive and clear the active PM2 error log.
2. Install and start the new release.
3. Run external, security, recovery, staging replay, health, and backup checks.
4. Keep the original PM2 PID under observation for 130 seconds.
5. Require strict `OK` health and verify that the PID did not change.
6. Record operational evidence and release the rollback trap.

A `WARN`, `FAIL`, unexpected PM2 restart, or non-zero command result during the
canary period automatically restores the previous release.

The soak can be increased for a manual deployment, but cannot be reduced below
60 seconds:

```powershell
powershell -ExecutionPolicy Bypass -File scripts/deploy-vps.ps1 -CanarySoakSeconds 300
```
