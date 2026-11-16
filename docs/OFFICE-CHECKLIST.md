# Office computer checklist: first Revit build

For the person at the Windows computer that has Revit. Takes about an hour the first time. Nothing here needs the client app; the office API only needs to be reachable for steps 7 and 9.

Send back everything listed under **Send back** in one email or shared folder. With those files the build script gets fixed without anyone sitting at the machine again.

## 1. Install (once)

- [ ] Revit installed and signed in with the office account. Open it once by hand, dismiss every first-run dialog (license, updates, recovery), close it.
- [ ] pyRevit installed from pyrevitlabs.io, then open a command prompt and run `pyrevit --version`. It must print a version. If "pyrevit is not recognized", log out and back in, or add its folder to PATH.
- [ ] Python 3.11 or newer from python.org, with "Add python.exe to PATH" ticked. `python --version` prints it.
- [ ] Copy the repo's `worker` folder to `C:\DraftHouse\worker`.
- [ ] The office template at `C:\DraftHouse\templates\STB Residential.rte` (or the real name) and the family library at `C:\DraftHouse\families`.
- [ ] Copy `config.example.json` to `config.json`. Fill in: `api` (the Render URL), `workerKey` (DRAFTHOUSE_WORKER_KEY from the Render service), `revitYear`, `revitExe` (the real Revit.exe path), `template`, `familiesDir`.

## 2. Smoke test: Revit launches with the template

```
cd C:\DraftHouse\worker
python draft_house_worker.py --smoke
```

Expect `smoke test OK` within a minute or two. If it fails:
- "pyrevit is not recognized": PATH, see step 1.
- Revit opens a dialog and sits there: close it, open Revit by hand, tick "do not show again", close, run again.
- "could not open template": the `template` path in config.json is wrong or the file is from a newer Revit.

**Send back:** the last 40 lines of `work\worker.log`.

## 3. Template names

```
python draft_house_worker.py --list-names
```

Writes `work\template-names.json`: every wall, floor and roof type, every door, window, title block and fixture family in the template, levels and view templates.

**Send back:** `work\template-names.json`.

## 4. Fill the name mapping

Copy `kit.revit.example.json` to `kit.revit.json`. For each line, put the exact name from `template-names.json` on the right side. Names the template does not have (for example "Sliding-Barn") stay as they are: the build falls back to the template default and lists the fallback on the job so you see what is missing.

Keep `roofSlopeUnits` at `ratio` for now (step 6 tells you if it must change).

## 5. Dry run without Revit

```
python revit\selfcheck.py <path to a design.json> --names work\template-names.json
```

A design.json: download one from the dashboard (any job's `design.json` link) or ask for the Garza one. Expect `SELFCHECK OK` with the counts and the list of names that will fall back. Fix the mapping until the fallback list is what you expect.

## 6. The Garza build, locally

```
python draft_house_worker.py --job <path to garza design.json>
```

Revit opens, the script runs, and the worker prints each step with a percentage. On success it prints `job ... built in Ns: model.rvt, sheets.pdf, model.ifc` and the output folder under `work\local-...`.

Open `model.rvt` in Revit and look at:
- Walls in the right place and height, doors and windows in walls, rooms named, one slab under the house.
- Roof: the slope must read 10/12. If it reads something like 40° or 0.69, set `"roofSlopeUnits": "radians"` in `kit.revit.json` and build again. The report also prints the slope it read.
- Sheets: nine sheets, the floor plan on sheet 200 with the title block.

**Send back:** the whole `work\local-...` folder (`report.json`, `revit.log`, `model.rvt`, `sheets.pdf`, `model.ifc`) and two screenshots of the model, plan and 3D. If it failed, `report.json` has `error` and `trace`, and `revit.log` has everything Revit printed. Send those even if the model is wrong; the fixes come from them.

## 7. Connect to the office

```
python draft_house_worker.py --once
```

One heartbeat to the office API and one job if one is waiting. The dashboard (Office page) must show this machine online with green checks. "API refused the worker key" means `workerKey` in config.json does not match the Render service.

## 8. Make it permanent

In an Administrator PowerShell:

```
cd C:\DraftHouse\worker
Set-ExecutionPolicy -Scope Process Bypass -Force
.\install.ps1
```

This registers two scheduled tasks: `DraftHouseWorker` (starts at logon, restarts itself every minute if it stops) and `DraftHouseWatchdog` (every 5 minutes, starts the worker if it is gone and kills a stuck Revit). It also stops the machine from sleeping.

Then automatic logon, so a reboot brings the worker back without a person: press Win+R, run `netplwiz`, untick "Users must enter a user name and password", OK, enter the office account password. (If the box is missing on Windows 11, set `HKLM\SOFTWARE\Microsoft\Windows NT\CurrentVersion\PasswordLess\Device\DevicePasswordLessBuildVersion` to 0 and open netplwiz again.) Keep the account's password in the office password manager; this machine is now always logged in, so put it behind the office door.

Reboot once and check the dashboard shows the machine online within two minutes.

## 9. Send back

1. `work\worker.log` (last 200 lines are enough)
2. `work\template-names.json`
3. `kit.revit.json` as you filled it
4. The `work\local-...` folder from the Garza build: `report.json`, `revit.log`, and the three outputs
5. Two screenshots of the model
6. The Revit year and build (Help, About)

## If Revit asks for anything on screen

The build runs unattended, so any dialog Revit shows stops it. The common ones: a missing family link ("Unresolved references": tick "ignore and continue" once, then it remembers), the save-to-central prompt (the template must not be workshared), and the journal recovery dialog after a crash (open Revit by hand once and dismiss it). The watchdog kills a Revit stuck longer than 30 minutes, and the job fails with the log attached.
