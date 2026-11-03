# Office Revit worker, install

One Windows machine with Revit. Nobody needs to sit at it.

1. Install Revit (2022 or newer) and sign in once with the office account.
2. Install pyRevit, then open a command prompt and run `pyrevit --version` to confirm the CLI is on PATH.
3. Install Python 3.11 or newer from python.org, ticking "Add to PATH".
4. Copy the `worker` folder to `C:\DraftHouse\worker`.
5. Put the office template at `C:\DraftHouse\templates\` and the family library at `C:\DraftHouse\families\`.
6. Copy `config.example.json` to `config.json` and fill in the API address (the Render URL, https), the worker key (`DRAFTHOUSE_WORKER_KEY` from the Render service, Environment tab) and the paths.
7. Test by hand: `python draft_house_worker.py`. Within a minute the dashboard shows the machine online with its checks.
8. Make it start at logon: Task Scheduler, new task, trigger "At log on", action `python C:\DraftHouse\worker\draft_house_worker.py`, "Run whether user is logged on or not". Set Windows to log the office account in automatically and never sleep.

## What the worker reports

Every 30 seconds: Revit installed, pyRevit CLI, template present, family count, disk space, and whether Revit launched and opened the template in the last smoke test. Every six hours it runs the smoke test again. The dashboard can ask for one with the "Run check" button.

## When something breaks

- Dashboard says offline: the machine is asleep, the task is not running, or the API address in config is wrong. After 10 minutes offline the office gets an alert email, and another when the worker is back.
- worker.log says the API refused the key (401 or 403): `workerKey` in config.json does not match `DRAFTHOUSE_WORKER_KEY` on the server.
- "Revit responds" fails: open Revit by hand on that machine and clear any dialog (license, update, recovery). The worker kills Revit after a failed job, but a dialog on first launch blocks it.
- A job fails twice: it stays failed with the Revit log attached. Retry from the dashboard after fixing the cause.

## Remote Control

Install the Claude desktop app on this machine and enable Remote Control for `C:\DraftHouse`. That lets the build script be tested on the real Revit from a Claude session.
