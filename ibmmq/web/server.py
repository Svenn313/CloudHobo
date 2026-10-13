#!/usr/bin/env python3
"""Portail d'entrainement IBM MQ : sert la page et valide les checkpoints.

Les verifications interrogent les queue managers via l'API REST de mqweb
(commandes MQSC), donc sans acces au socket Docker. La progression est
stockee dans un fichier JSON.
"""
import base64
import json
import os
import re
import ssl
import threading
import urllib.request
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

WEB_DIR = Path(__file__).resolve().parent
DATA_FILE = Path(os.environ.get('PROGRESS_FILE', '/data/progress.json'))
ADMIN_PASSWORD = os.environ['MQ_ADMIN_PASSWORD']
ENDPOINTS = {
    'QM1': os.environ.get('MQ_QM1_URL', 'https://mq-qm1:9443'),
    'QM2': os.environ.get('MQ_QM2_URL', 'https://mq-qm2:9443'),
}
LAST_DAY = 24
CTX = ssl.create_default_context()
CTX.check_hostname = False
CTX.verify_mode = ssl.CERT_NONE
LOCK = threading.Lock()


# --- acces MQ ---------------------------------------------------------------

def mqsc(qm, command):
    """Execute une commande MQSC. Renvoie (trouve, texte)."""
    url = f'{ENDPOINTS[qm]}/ibmmq/rest/v2/admin/action/qmgr/{qm}/mqsc'
    body = json.dumps({'type': 'runCommand', 'parameters': {'command': command}}).encode()
    token = base64.b64encode(f'admin:{ADMIN_PASSWORD}'.encode()).decode()
    req = urllib.request.Request(url, data=body, headers={
        'Authorization': f'Basic {token}',
        'Content-Type': 'application/json',
        'ibm-mq-rest-csrf-token': 'x',
    })
    try:
        with urllib.request.urlopen(req, timeout=8, context=CTX) as resp:
            data = json.load(resp)
    except urllib.error.HTTPError as e:  # MQ renvoie parfois un 4xx avec un corps JSON
        try:
            data = json.load(e)
        except Exception:
            raise RuntimeError(f'{qm} : HTTP {e.code}')
    except Exception as e:
        raise RuntimeError(f'{qm} injoignable ({e})')
    responses = data.get('commandResponse', [])
    text = ' '.join(t for r in responses for t in r.get('text', []))
    found = data.get('overallCompletionCode', 2) == 0
    return found, text


def attr(text, name):
    m = re.search(rf'\b{name}\(([^)]*)\)', text)
    return m.group(1).strip() if m else None


def display(qm, command):
    """Renvoie le texte d'un DISPLAY, ou None si l'objet n'existe pas."""
    found, text = mqsc(qm, command)
    return text if found else None


def queue_info(qm, name, kind='QLOCAL'):
    return display(qm, f'DISPLAY {kind}({name}) CURDEPTH MAXDEPTH DEFPSIST DESCR USAGE RNAME RQMNAME')


def chl_status(qm, name):
    text = display(qm, f'DISPLAY CHSTATUS({name}) STATUS')
    return attr(text, 'STATUS') if text else None  # None = canal inactif


# --- aides de verification --------------------------------------------------

def check(label, ok, detail=''):
    return {'label': label, 'ok': bool(ok), 'detail': detail}


def norm(s):
    return re.sub(r'[\s_.\-\'"]', '', (s or '').lower())


def quiz(label, answers, qid, accepted):
    given = norm(answers.get(qid, ''))
    ok = bool(given) and any(norm(a) and norm(a) in given for a in accepted)
    return check(label, ok, '' if ok else ('Réponse manquante.' if not given else "Ce n'est pas la bonne réponse."))


def queue_state(label, qm, name, want_exists=True, depth=None, maxdepth=None, psist=None):
    """Verifie l'existence et quelques attributs d'une queue locale."""
    text = queue_info(qm, name)
    if not want_exists:
        return [check(f'{name} n\'existe plus sur {qm}', text is None)]
    if text is None:
        return [check(f'{name} existe sur {qm}', False, 'Queue introuvable.')]
    out = [check(f'{name} existe sur {qm}', True)]
    if depth is not None:
        cur = int(attr(text, 'CURDEPTH') or -1)
        out.append(check(f'{name} contient {depth} message(s)', cur == depth, f'Actuellement : {cur}'))
    if maxdepth is not None:
        cur = int(attr(text, 'MAXDEPTH') or -1)
        out.append(check(f'{name} a MAXDEPTH({maxdepth})', cur == maxdepth, f'Actuellement : {cur}'))
    if psist is not None:
        cur = attr(text, 'DEFPSIST')
        out.append(check(f'{name} a DEFPSIST({psist})', cur == psist, f'Actuellement : {cur}'))
    return out


def channel_def(qm, name, chltype):
    text = display(qm, f'DISPLAY CHANNEL({name}) CHLTYPE')
    got = attr(text, 'CHLTYPE') if text else None
    return check(f'Canal {name} de type {chltype} sur {qm}', got == chltype,
                 'Canal introuvable.' if text is None else f'Type actuel : {got}')


def remote_queue(qm, name, rname, rqmname):
    text = queue_info(qm, name, 'QREMOTE')
    ok = bool(text) and attr(text, 'RNAME') == rname and attr(text, 'RQMNAME') == rqmname
    return check(f'{name} (QREMOTE) pointe vers {rname} sur {rqmname}', ok,
                 'Queue distante introuvable.' if text is None else f'RNAME={attr(text, "RNAME")} RQMNAME={attr(text, "RQMNAME")}')


# --- checkpoints par jour ---------------------------------------------------

def day1(a):
    r = []
    for qm in ('QM1', 'QM2'):
        text = display(qm, 'DISPLAY QMSTATUS STATUS')
        r.append(check(f'{qm} est en marche', attr(text or '', 'STATUS') == 'RUNNING'))
    dead = attr(display('QM1', 'DISPLAY QMGR DEADQ') or '', 'DEADQ') or ''
    return r + [quiz('Dead letter queue de QM1', a, 'deadq', [dead])]


def day2(a):
    live = attr(queue_info('QM1', 'DEV.QUEUE.1') or '', 'MAXDEPTH') or ''
    return [quiz('MAXDEPTH de DEV.QUEUE.1', a, 'maxdepth', [live])]


def day3(a):
    r = queue_state('', 'QM1', 'TEST.QUEUE', maxdepth=100)
    text = queue_info('QM1', 'TEST.QUEUE') or ''
    r.append(check('TEST.QUEUE a une description', 'DESCR(ma premiere queue)' in text or bool(attr(text, 'DESCR'))))
    return r


def day7(a):
    return (queue_state('', 'QM1', 'TEST.QUEUE', want_exists=False)
            + queue_state('', 'QM1', 'ETUDE.ORDRES', depth=3, maxdepth=3))


def authrec(qm, profile, principal, perms):
    text = display(qm, f'DISPLAY AUTHREC PROFILE({profile}) OBJTYPE(QUEUE) PRINCIPAL(\'{principal}\')') or ''
    have = (attr(text, 'AUTHLIST') or '').upper().split(',')
    missing = [p for p in perms if p not in have]
    return check(f'{principal} a les droits {"/".join(perms)} sur {profile}', text != '' and not missing,
                 f'Droits actuels : {",".join(have) or "aucun"}')


def day8(a):
    return queue_state('', 'QM1', 'TEST.QUEUE') + [authrec('QM1', 'TEST.QUEUE', 'app', ['PUT', 'GET'])]


def day11(a):
    text = display('QM1', 'DISPLAY CONN(*) TYPE(CONN) APPLTAG') or ''
    live = 'console' if 'console' in text.lower() else None
    return [quiz('Programme de la console web', a, 'appltag', [live or 'console'])]


def chlauth_rule(qm, name, mcauser='mqm'):
    text = display(qm, f"DISPLAY CHLAUTH({name}) TYPE(ADDRESSMAP) MCAUSER")
    return text is not None and f'MCAUSER({mcauser})' in text


def day15(a):
    r = queue_state('', 'QM2', 'ORDERS')
    r.append(channel_def('QM2', 'QM1.QM2', 'RCVR'))
    r.append(check('Règle CHLAUTH QM1.QM2 présente sur QM2', chlauth_rule('QM2', 'QM1.QM2')))
    return r


def day16(a):
    r = []
    x = queue_info('QM1', 'QM2.XMIT')
    r.append(check('QM2.XMIT est une queue de transmission', bool(x) and attr(x, 'USAGE') == 'XMITQ'))
    r.append(remote_queue('QM1', 'ORDERS.TO.QM2', 'ORDERS', 'QM2'))
    r.append(channel_def('QM1', 'QM1.QM2', 'SDR'))
    st = chl_status('QM1', 'QM1.QM2')
    r.append(check('Le canal QM1.QM2 est RUNNING', st == 'RUNNING', f'État : {st or "inactif"}'))
    return r


def day17(a):
    return (queue_state('', 'QM2', 'ORDERS', depth=1)
            + queue_state('', 'QM1', 'QM2.XMIT', depth=0))


def day18(a):
    st = chl_status('QM1', 'QM1.QM2')
    return (queue_state('', 'QM1', 'QM2.XMIT', depth=3)
            + [check('Le canal QM1.QM2 est arrêté', st != 'RUNNING', f'État : {st or "inactif"}')])


def day19(a):
    st = chl_status('QM1', 'QM1.QM2')
    return [check('Règle CHLAUTH retirée sur QM2', not chlauth_rule('QM2', 'QM1.QM2')),
            check('Le canal QM1.QM2 ne tourne pas', st != 'RUNNING', f'État : {st or "inactif"}')]


def day20(a):
    dlq = queue_info('QM2', 'DEV.DEAD.LETTER.QUEUE')
    depth = int(attr(dlq or '', 'CURDEPTH') or 0)
    return [remote_queue('QM1', 'GHOST.TO.QM2', 'GHOST', 'QM2'),
            check('La dead letter queue de QM2 contient un message', depth >= 1, f'Profondeur : {depth}'),
            quiz('Raison indiquée dans l\'en-tête', a, 'reason', ['2085', 'unknownobjectname', 'MQRC_UNKNOWN_OBJECT_NAME'])]


def day21(a):
    st = chl_status('QM1', 'QM1.QM2')
    return [check('Le canal QM1.QM2 est RUNNING', st == 'RUNNING', f'État : {st or "inactif"}'),
            quiz('IPPROCS', a, 'ipprocs', ['lecteur', 'reader', 'input', 'get', 'lecture', 'consommat'])]


def day22(a):
    return queue_state('', 'QM1', 'REST.QUEUE')


def day24(a):
    r = queue_state('', 'QM2', 'INVOICES', depth=5)
    text = display('QM1', 'DISPLAY QREMOTE(*) RNAME RQMNAME') or ''
    ok = bool(re.search(r'RNAME\(INVOICES\)\s+RQMNAME\(QM2\)', text)) or ('RNAME(INVOICES)' in text and 'RQMNAME(QM2)' in text)
    r.append(check('Une queue distante de QM1 mène à INVOICES sur QM2', ok))
    return r


CHECKS = {
    1: day1,
    2: day2,
    3: day3,
    4: lambda a: queue_state('', 'QM1', 'TEST.QUEUE', depth=3),
    5: lambda a: queue_state('', 'QM1', 'TEST.QUEUE', depth=0),
    6: lambda a: queue_state('', 'QM1', 'TEST.QUEUE', depth=2, maxdepth=2),
    7: day7,
    8: day8,
    9: lambda a: [quiz('Code retour « non autorisé »', a, 'rc', ['2035', 'notauthorized'])],
    10: lambda a: [quiz('USERSRC de la règle qui bloque tout', a, 'usersrc', ['noaccess'])],
    11: day11,
    12: lambda a: queue_state('', 'QM1', 'TEST.QUEUE', depth=1, psist='YES'),
    13: lambda a: [quiz('Code retour « queue inconnue »', a, 'rc', ['2085', 'unknownobject'])]
                  + queue_state('', 'QM1', 'TEST.QUEUE', depth=0),
    14: lambda a: [
        quiz('Où lire les causes détaillées', a, 'q1', ['amqerr01', 'amqerr', 'logs', 'log']),
        quiz('Commande des règles de canal', a, 'q2', ['displaychlauth', 'chlauth']),
        quiz('Propriété de persistance', a, 'q3', ['defpsist', 'persist']),
    ],
    15: day15,
    16: day16,
    17: day17,
    18: day18,
    19: day19,
    20: day20,
    21: day21,
    22: day22,
    23: lambda a: [quiz('Dossier des données de QM2', a, 'path', ['volumes/qm2', 'qm2'])],
    24: day24,
}


# --- progression -------------------------------------------------------------

def load_progress():
    try:
        return json.loads(DATA_FILE.read_text())
    except Exception:
        return {'validated': {}}


def save_progress(p):
    DATA_FILE.parent.mkdir(parents=True, exist_ok=True)
    tmp = DATA_FILE.with_suffix('.tmp')
    tmp.write_text(json.dumps(p, indent=2))
    tmp.replace(DATA_FILE)


def progress_view():
    p = load_progress()
    done = sorted(int(d) for d in p['validated'])
    current = next((d for d in range(1, LAST_DAY + 1) if d not in done), LAST_DAY + 1)
    return {'validated': p['validated'], 'current': current, 'last': LAST_DAY}


# --- HTTP --------------------------------------------------------------------

MIME = {'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
        '.css': 'text/css; charset=utf-8'}
STATIC = {'/': 'index.html', '/index.html': 'index.html', '/program.js': 'program.js'}


class Handler(BaseHTTPRequestHandler):
    def log_message(self, fmt, *args):
        pass

    def send_json(self, obj, status=200):
        body = json.dumps(obj).encode()
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        path = self.path.split('?')[0]
        if path == '/api/progress':
            return self.send_json(progress_view())
        name = STATIC.get(path)
        if not name:
            return self.send_json({'error': 'not found'}, 404)
        body = (WEB_DIR / name).read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', MIME[Path(name).suffix])
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-cache')
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        try:
            length = int(self.headers.get('Content-Length') or 0)
            payload = json.loads(self.rfile.read(length) or b'{}')
        except Exception:
            return self.send_json({'error': 'JSON invalide'}, 400)

        if self.path == '/api/reset':
            with LOCK:
                save_progress({'validated': {}})
            return self.send_json(progress_view())

        if self.path != '/api/check':
            return self.send_json({'error': 'not found'}, 404)

        day = payload.get('day')
        answers = payload.get('answers') or {}
        if not isinstance(day, int) or day not in CHECKS:
            return self.send_json({'error': 'jour inconnu'}, 400)
        with LOCK:
            view = progress_view()
            if day > view['current']:
                return self.send_json({'error': 'Cet exercice est verrouillé.'}, 403)
            try:
                results = CHECKS[day](answers)
            except Exception as e:
                return self.send_json({'error': f'Vérification impossible : {e}'}, 502)
            ok = all(r['ok'] for r in results)
            if ok:
                p = load_progress()
                p['validated'][str(day)] = datetime.now(timezone.utc).isoformat(timespec='seconds')
                save_progress(p)
            return self.send_json({'ok': ok, 'results': results, 'progress': progress_view()})


if __name__ == '__main__':
    ThreadingHTTPServer(('0.0.0.0', 8080), Handler).serve_forever()
