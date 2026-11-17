# Office Revit worker, install

One Windows machine with Revit. Nobody needs to sit at it.

1. Install Revit (2022 or newer) and sign in once with the office account.
2. Install pyRevit, then open a command prompt and run `pyrevit --version` to confirm the CLI is on PATH.
3. Install Python 3.11 or newer from python.org, ticking "Add to PATH".
4. Copy the `worker` folder to `C:\DraftHouse\worker`.
5. Put the office template at `C:\DraftHouse\templates\` and the family library at `C:\DraftHouse\families\`.
6. Copy `config.example.json` to `config.json` and fill in the API address (the Render URL, https), the worker key (`DRAFTHOUSE_WORKER_KEY` from the Render service, Environment tab) and the paths.
7. Test by hand, in this order (details and what to send back in `docs/OFFICE-CHECKLIST.md`): `python draft_house_worker.py --smoke` (Revit opens the template), `--list-names` (writes `work\template-names.json`), fill `kit.revit.json` from it (copy `kit.revit.example.json`), `python revit\selfcheck.py <design.json> --names work\template-names.json` (dry run, no Revit), `--job <design.json>` (one real build, outputs under `work\local-...`), then `--once` (one heartbeat; the dashboard shows the machine online).
8. Make it permanent: in an Administrator PowerShell, `Set-ExecutionPolicy -Scope Process Bypass -Force; .\install.ps1`. It registers the `DraftHouseWorker` scheduled task (at logon, restarts itself every minute if it stops) and the `DraftHouseWatchdog` task (every 5 minutes), and turns sleep off. A service in session 0 cannot drive Revit, which needs a desktop, so the worker runs as a task in the logged-on session. Then set automatic logon (`netplwiz`) so a reboot brings it back without a person. `uninstall.ps1` removes both tasks.

## Name mapping

`kit.revit.json` maps the kit's names (wall types, door and window families, fixtures, floor and roof types, title block) to the office template's names. Every name the template does not have falls back to the template default and shows on the job as `name fallback: ...`. The health check "Revit name mapping" says whether the file is present.

## What the worker reports

Every 30 seconds: Revit installed, pyRevit CLI, template present, family count, disk space, and whether Revit launched and opened the template in the last smoke test. Every six hours it runs the smoke test again. The dashboard can ask for one with the "Run check" button.

## When something breaks

- Dashboard says offline: the machine is asleep, the task is not running, or the API address in config is wrong. After 10 minutes offline the office gets an alert email, and another when the worker is back.
- worker.log says the API refused the key (401 or 403): `workerKey` in config.json does not match `DRAFTHOUSE_WORKER_KEY` on the server.
- "Revit responds" fails: open Revit by hand on that machine and clear any dialog (license, update, recovery). The worker kills Revit after a failed job, but a dialog on first launch blocks it.
- A job fails twice: it stays failed with the Revit log attached. Retry from the dashboard after fixing the cause.

## Remote Control

Install the Claude desktop app on this machine and enable Remote Control for `C:\DraftHouse`. That lets the build script be tested on the real Revit from a Claude session.
