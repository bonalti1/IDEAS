"""
Draft House Revit worker. Runs on the office machine that has Revit and pyRevit.

Every 10 s it asks the office API for a job. For each job it downloads the
design, runs Revit through the pyRevit CLI with revit/build_model.py against
the office template, uploads the Revit file, the PDF set and the IFC, and
reports done or failed. Every 30 s it sends a heartbeat with health checks.

Install: see worker/INSTALL.md. Config: worker/config.json (copy the example).
Run:     python draft_house_worker.py                 the loop (what the scheduled task runs)
         python draft_house_worker.py --smoke         open Revit once with the template and exit
         python draft_house_worker.py --list-names    write template-names.json for kit.revit.json
         python draft_house_worker.py --job design.json   build one design locally, no API needed
         python draft_house_worker.py --once          one heartbeat and at most one job, then exit
"""
import json, os, sys, time, shutil, socket, subprocess, platform, traceback, urllib.request, urllib.error

HERE = os.path.dirname(os.path.abspath(__file__))
CFG = json.load(open(os.path.join(HERE, 'config.json')))
API = CFG['api'].rstrip('/')
WORKER_KEY = (CFG.get('workerKey') or os.environ.get('DRAFTHOUSE_WORKER_KEY') or '').strip()
if API.startswith('http://') and 'localhost' not in API and '127.0.0.1' not in API:
    print('WARNING: api is not https; the worker key would travel in the clear')
WORKER_ID = CFG.get('id') or socket.gethostname().lower()
NAME = CFG.get('name', 'Office Revit')
REVIT_YEAR = str(CFG.get('revitYear', '2024'))
REVIT_EXE = CFG.get('revitExe', r'C:\Program Files\Autodesk\Revit %s\Revit.exe' % REVIT_YEAR)
TEMPLATE = CFG['template']
FAMILIES = CFG.get('familiesDir', '')
WORK = CFG.get('workDir', os.path.join(HERE, 'work'))
JOB_TIMEOUT_S = int(CFG.get('jobTimeoutS', 900))
VERSION = '0.1.0'
BUILD_SCRIPT = os.path.join(HERE, 'revit', 'build_model.py')
NAMES_SCRIPT = os.path.join(HERE, 'revit', 'list_names.py')
MAP_FILE = os.path.join(HERE, 'kit.revit.json')

os.makedirs(WORK, exist_ok=True)
log_file = open(os.path.join(WORK, 'worker.log'), 'a')

def log(msg):
    line = '%s %s' % (time.strftime('%Y-%m-%d %H:%M:%S'), msg)
    print(line); log_file.write(line + '\n'); log_file.flush()

def api(method, path, body=None, raw=None):
    data = raw if raw is not None else (json.dumps(body).encode() if body is not None else None)
    req = urllib.request.Request(API + path, data=data, method=method)
    req.add_header('content-type', 'application/octet-stream' if raw is not None else 'application/json')
    if WORKER_KEY:
        req.add_header('x-api-key', WORKER_KEY)
    try:
        with urllib.request.urlopen(req, timeout=30) as r:
            txt = r.read().decode()
            return r.status, (json.loads(txt) if txt else {})
    except urllib.error.HTTPError as e:
        if e.code in (401, 403):
            log('API refused the worker key (%s). Check workerKey in config.json against DRAFTHOUSE_WORKER_KEY on the server.' % e.code)
        return e.code, {}
    except Exception as e:
        return 0, {'error': str(e)}

# ── health checks ────────────────────────────────────────────────────────────
def pyrevit_version():
    try:
        out = subprocess.run(['pyrevit', '--version'], capture_output=True, text=True, timeout=20).stdout.strip()
        return out.split()[-1] if out else None
    except Exception:
        return None

last_smoke = {'at': None, 'ok': False, 's': None}

def smoke_test():
    """Open Revit with the template and run a no-op script. Proves Revit launches."""
    t0 = time.time()
    try:
        r = subprocess.run(['pyrevit', 'run', os.path.join(HERE, 'revit', 'smoke.py'), TEMPLATE, '--revit=' + REVIT_YEAR, '--purge'], capture_output=True, text=True, timeout=300)
        ok = r.returncode == 0 and 'DRAFT_HOUSE_SMOKE_OK' in (r.stdout + r.stderr)
    except Exception as e:
        ok = False
    last_smoke.update({'at': time.strftime('%Y-%m-%dT%H:%M:%S'), 'ok': ok, 's': int(time.time() - t0)})
    return ok

def list_names():
    """Write template-names.json (the names kit.revit.json must use) from the office template."""
    env = dict(os.environ, DH_OUT=WORK)
    r = subprocess.run(['pyrevit', 'run', NAMES_SCRIPT, TEMPLATE, '--revit=' + REVIT_YEAR, '--purge'], capture_output=True, text=True, timeout=600, env=env)
    out = r.stdout + r.stderr
    ok = 'DRAFT_HOUSE_NAMES_OK' in out
    log('list-names %s\n%s' % ('ok' if ok else 'FAILED', out[-3000:]))
    if ok:
        log('template names written to %s' % os.path.join(WORK, 'template-names.json'))
    return ok

def checks():
    now = time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime())
    disk = shutil.disk_usage(WORK)
    free_gb = disk.free / 1e9
    fam = len([f for f in os.listdir(FAMILIES) if f.lower().endswith('.rfa')]) if FAMILIES and os.path.isdir(FAMILIES) else 0
    pv = pyrevit_version()
    c = [
        {'id': 'revit-exe', 'name': 'Revit %s installed' % REVIT_YEAR, 'ok': os.path.exists(REVIT_EXE), 'detail': REVIT_EXE, 'at': now},
        {'id': 'pyrevit', 'name': 'pyRevit CLI', 'ok': bool(pv), 'detail': ('v' + pv) if pv else 'not found on PATH', 'at': now},
        {'id': 'template', 'name': 'Office template', 'ok': os.path.exists(TEMPLATE), 'detail': os.path.basename(TEMPLATE), 'at': now},
        {'id': 'families', 'name': 'Family library', 'ok': fam > 0, 'detail': '%d families' % fam, 'at': now},
        {'id': 'disk', 'name': 'Disk space', 'ok': free_gb > 10, 'detail': '%.0f GB free' % free_gb, 'at': now},
        {'id': 'revit-smoke', 'name': 'Revit responds', 'ok': bool(last_smoke['ok']), 'detail': ('launched in %ss at %s' % (last_smoke['s'], last_smoke['at'])) if last_smoke['at'] else 'not run yet', 'at': now},
        {'id': 'mapping', 'name': 'Revit name mapping', 'ok': os.path.exists(MAP_FILE), 'detail': 'kit.revit.json present' if os.path.exists(MAP_FILE) else 'no kit.revit.json: kit names used as-is, fallbacks logged per job', 'at': now},
    ]
    return c, pv, fam, free_gb

def heartbeat(current=None):
    c, pv, fam, free_gb = checks()
    status, body = api('POST', '/api/workers/heartbeat', {
        'id': WORKER_ID, 'name': NAME, 'host': socket.gethostname(), 'revit': REVIT_YEAR, 'pyrevit': pv,
        'template': os.path.basename(TEMPLATE), 'families': fam, 'disk': '%.0f GB free' % free_gb,
        'version': VERSION, 'platform': platform.platform(), 'checks': c, 'current': current,
    })
    if status != 200:
        log('heartbeat failed: %s %s' % (status, body))
        return []
    return body.get('commands', [])

# ── jobs ─────────────────────────────────────────────────────────────────────
def kill_revit():
    if os.name == 'nt':
        subprocess.run(['taskkill', '/IM', 'Revit.exe', '/F'], capture_output=True)

def run_job(job, local_design=None):
    """Build one job. With local_design (a path) nothing is fetched or reported to the API."""
    jid = job['id']
    jdir = os.path.join(WORK, jid)
    os.makedirs(jdir, exist_ok=True)
    if local_design:
        progress = lambda step, msg, pct: log('  %3d%% %s: %s' % (pct, step, msg))
    else:
        progress = lambda step, msg, pct: api('POST', '/api/jobs/%s/progress' % jid, {'step': step, 'message': msg, 'pct': pct})
    try:
        if local_design:
            design = json.load(open(local_design))
        else:
            progress('download', 'fetching design', 5)
            status, design = api('GET', job['designUrl'])
            if status != 200:
                raise RuntimeError('could not download design (%s)' % status)
        if design.get('contract') != 1:
            raise RuntimeError('design contract %s is not 1' % design.get('contract'))
        design_path = os.path.join(jdir, 'design.json')
        json.dump(design, open(design_path, 'w'))
        out_rvt = os.path.join(jdir, 'model.rvt')
        env = dict(os.environ, DH_DESIGN=design_path, DH_OUT=jdir, DH_TEMPLATE=TEMPLATE, DH_FAMILIES=FAMILIES, DH_JOB=jid, DH_MAP=MAP_FILE)
        progress('revit', 'starting Revit %s' % REVIT_YEAR, 10)
        t0 = time.time()
        proc = subprocess.Popen(['pyrevit', 'run', BUILD_SCRIPT, TEMPLATE, '--revit=' + REVIT_YEAR, '--purge'], env=env, stdout=subprocess.PIPE, stderr=subprocess.STDOUT, text=True)
        out_lines = []
        while True:
            line = proc.stdout.readline()
            if line:
                out_lines.append(line.rstrip())
                if line.startswith('DH_PROGRESS '):
                    try:
                        _, pct, step, msg = line.strip().split(' ', 3)
                        progress(step, msg, int(pct))
                    except Exception:
                        pass
            elif proc.poll() is not None:
                break
            if time.time() - t0 > JOB_TIMEOUT_S:
                kill_revit(); proc.kill()
                raise RuntimeError('Revit did not finish in %ds' % JOB_TIMEOUT_S)
        log_txt = '\n'.join(out_lines)
        report_path = os.path.join(jdir, 'report.json')
        report = json.load(open(report_path)) if os.path.exists(report_path) else {}
        open(os.path.join(jdir, 'revit.log'), 'w').write(log_txt)
        if proc.returncode != 0 or not report.get('ok'):
            raise RuntimeError(report.get('error') or 'Revit script failed (exit %s)' % proc.returncode)
        warnings = list(report.get('warnings', []))
        for fb in report.get('fallbacks', []):
            line = 'name fallback: %s "%s" -> "%s"' % (fb.get('kind'), fb.get('wanted'), fb.get('used'))
            if line not in warnings:
                warnings.append(line)
        if local_design:
            log('job %s built in %ds: %s; %d warnings, %d name fallbacks' % (jid, time.time() - t0, ', '.join(report.get('outputs', [])), len(report.get('warnings', [])), len(report.get('fallbacks', []))))
            for w in warnings:
                log('  ' + w)
            log('outputs in %s' % jdir)
            return True
        progress('upload', 'uploading outputs', 85)
        outputs = []
        for name in ['model.rvt', 'sheets.pdf', 'model.ifc', 'report.json', 'revit.log']:
            p = os.path.join(jdir, name)
            if os.path.exists(p):
                st, body = api('PUT', '/api/jobs/%s/files/%s' % (jid, name), raw=open(p, 'rb').read())
                if st == 200:
                    outputs.append({'name': name, 'url': body.get('url')})
        api('POST', '/api/jobs/%s/complete' % jid, {'outputs': outputs, 'warnings': warnings, 'fallbacks': report.get('fallbacks', []), 'log': log_txt[-20000:]})
        log('job %s done in %ds' % (jid, time.time() - t0))
        return True
    except Exception as e:
        log('job %s failed: %s' % (jid, e))
        kill_revit()
        if local_design:
            log(traceback.format_exc())
            return False
        api('POST', '/api/jobs/%s/fail' % jid, {'error': str(e), 'log': traceback.format_exc()[-5000:]})
        return False

def main():
    args = sys.argv[1:]
    log('worker %s v%s starting, api %s, key %s, revit %s, template %s' % (WORKER_ID, VERSION, API, ('%d chars' % len(WORKER_KEY)) if WORKER_KEY else 'NONE (only works against an open office API)', REVIT_YEAR, TEMPLATE))
    if '--smoke' in args:
        ok = smoke_test()
        log('smoke test %s: %s' % ('OK' if ok else 'FAILED', json.dumps(last_smoke)))
        sys.exit(0 if ok else 1)
    if '--list-names' in args:
        sys.exit(0 if list_names() else 1)
    if '--job' in args:
        path = args[args.index('--job') + 1]
        ok = run_job({'id': 'local-' + time.strftime('%Y%m%d-%H%M%S')}, local_design=path)
        sys.exit(0 if ok else 1)
    once = '--once' in args
    smoke_test()
    last_hb = 0
    last_smoke_t = time.time()
    while True:
        try:
            if time.time() - last_hb > 30:
                for cmd in heartbeat():
                    log('command: %s' % cmd)
                    if cmd == 'smoke': smoke_test()
                    elif cmd == 'restart-revit': kill_revit()
                last_hb = time.time()
            if time.time() - last_smoke_t > 6 * 3600:
                smoke_test(); last_smoke_t = time.time()
            status, job = api('POST', '/api/jobs/claim', {'worker': WORKER_ID})
            if status == 200 and job.get('id'):
                heartbeat(current=job['id'])
                run_job(job)
                heartbeat(current=None)
                last_hb = time.time()
                if once:
                    break
            else:
                if once:
                    log('no job waiting')
                    break
                time.sleep(10)
        except KeyboardInterrupt:
            break
        except Exception as e:
            log('loop error: %s' % e)
            time.sleep(15)

if __name__ == '__main__':
    main()
