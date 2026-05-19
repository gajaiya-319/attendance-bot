# Attendance Bot Runbook

This runbook is for operating and checking the Discord attendance bot.

## Before Restarting

Run these checks from this folder:

```powershell
cd "C:\Users\hyun yong\Documents\Codex\2026-05-16\require-dotenv-config-const-fssync-require"
npm.cmd test
node -e "const fs=require('fs'); const src=fs.readFileSync('INDEX.JS','utf8'); new Function(src); console.log('syntax ok');"
```

Expected results:

```txt
time-logic tests passed
state-policy tests passed
syntax ok
```

If `npm test` fails in PowerShell because of execution policy, use:

```powershell
npm.cmd test
```

## Restart

Use the same method normally used to run the bot.

Common local command:

```powershell
node INDEX.JS
```

After restart, run this in Discord:

```txt
/refresh
```

## Backup

Before risky changes or manual data fixes, create a backup:

```txt
/backup-create
```

Check available backups:

```txt
/backup-list
```

Restore only when necessary:

```txt
/backup-restore
```

Restore is owner-only and changes live attendance data.

## Time Rules

Timezone:

```txt
Asia/Manila
```

Current schedule:

```txt
Day default: 09:00-21:00
Day Tuesday: 09:00-19:00
Night default: 21:00-09:00 next day
Night Tuesday: 19:00-04:00 next day
Maintenance: Wednesday 04:00-09:00
Pre-shift live buffer: 10 minutes
```

Time logic is tested in:

```txt
tests/time-logic.test.js
```

State transition policy is tested in:

```txt
tests/state-policy.test.js
```

## DC / LIVE OFF Policy

Grace periods:

```txt
DC grace: 10 minutes
LIVE OFF warning: 10 minutes
LIVE OFF auto clock-out: 10 minutes
```

If a user exceeds DC or LIVE OFF grace:

```txt
The bot auto-closes attendance.
If it is before scheduled end, this may count as early clock-out.
```

DM policy:

```txt
LIVE OFF: a gentle reminder is sent after 10 minutes.
DC: no immediate DM is sent.
DC timeout: one DM is sent when the bot auto-clocks the user out.
After DC timeout, returning to voice keeps FINISHED and sends one "CLOCK IN required" guide.
```

## Auto Resume Policy

If auto clock-out was caused by `dc-timeout` or `live-off-timeout`:

```txt
Return within 60 minutes + LIVE ON
=> attendance resumes automatically
=> reversible early penalty is removed
```

If the user returns after more than 60 minutes:

```txt
The bot does NOT resume automatically.
The user receives a DM.
The user must keep LIVE ON and press CLOCK IN.
Attendance is not counted until CLOCK IN is pressed while LIVE ON.
```

If the user presses CLOCK IN while LIVE OFF in this state:

```txt
Attendance remains FINISHED.
The user is told to turn LIVE ON and press CLOCK IN again.
```

## Finished Display Policy

After clock-out:

```txt
FINISHED is shown for 30 minutes, even if the user leaves voice.
After 30 minutes, they are hidden from the dashboard.
```

Overtime users are excluded from this hiding rule.

## Day Off Policy

Day off users are not auto-clocked in by voice or LIVE ON.

If a day off user appears in voice or turns LIVE ON:

```txt
Day Off is kept.
The bot notifies the user/admin flow.
```

If the user is actually working, an admin should handle it.

## Useful Admin Commands

```txt
/refresh
/sync-working
/permission-check
/data-audit
/status-audit
/time-audit
/dayoff-list
/dayoff-log
/backup-create
/backup-list
```

High-risk commands:

```txt
/backup-restore
/reset-user
/reset-all
/manual-adjust
/force-in
/force-out
/force-early-out
/force-off
/force-ot
/clear-roles
/fire
```

Use high-risk commands only after creating a backup.

Successful high-risk admin actions are logged to the log channel with actor, target, and details.

## Common Troubleshooting

User is FINISHED but says they are working:

```txt
Check if they exceeded DC/LIVE OFF grace.
If within 60 minutes and LIVE ON, refresh should auto-resume.
If over 60 minutes, they must turn LIVE ON and press CLOCK IN.
```

User pressed CLOCK IN but attendance did not start:

```txt
Check if they are in voice and LIVE ON.
CLOCK IN while LIVE OFF does not count.
```

User is not visible on dashboard:

```txt
They may be FINISHED and hidden after 30 minutes.
They may not match the current shift role.
They may be Day Off.
Run /refresh if state looks stale.
```

Time looks wrong:

```txt
Run /time-audit.
Run npm.cmd test locally.
Check CONFIG.TIMEZONE.
```
