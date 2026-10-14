#!/usr/bin/env python3
"""Static SCALP UI + Coinglass proxy + exchange forward proxy (CORS).

Usage:
  python3 local/serve.py
  → http://127.0.0.1:4173/local/
  Coinglass: /cg/api/...
  Exchange:  POST /ex/forward  {url, method, headers, body}
"""
from __future__ import annotations

import http.server
import json
import os
import socketserver
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

ROOT = Path(__file__).resolve().parents[1]
PORT = int(os.environ.get('SCALP_PORT', '4173'))
CG_BASE = 'https://open-api-v4.coinglass.com'
CG_KEY = os.environ.get('COINGLASS_API_KEY', '')
# 1 = block Telegram sendMessage through /ex/forward; default off (RSI alerts allowed)
TG_MUTE = os.environ.get('SCALP_TG_MUTE', '0') != '0'

ALLOWED_HOSTS = {
    'api.binance.com',
    'testnet.binance.vision',
    'fapi.binance.com',
    'testnet.binancefuture.com',
    'dapi.binance.com',
    'api.bybit.com',
    'api-testnet.bybit.com',
    'api.telegram.org',
}


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header(
            'Access-Control-Allow-Headers',
            'CG-API-KEY, Content-Type, X-MBX-APIKEY, '
            'X-BAPI-API-KEY, X-BAPI-SIGN, X-BAPI-TIMESTAMP, X-BAPI-RECV-WINDOW',
        )
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        path = (self.path or '').split('?', 1)[0]
        if path.endswith(('.js', '.css', '.html')):
            self.send_header('Cache-Control', 'no-store, max-age=0')
        super().end_headers()

    def do_OPTIONS(self):
        self.send_response(204)
        self.end_headers()

    def do_GET(self):
        if self.path.startswith('/cg/'):
            return self._proxy_cg()
        return super().do_GET()

    def do_POST(self):
        if self.path.split('?', 1)[0] == '/ex/forward':
            return self._proxy_ex()
        self.send_error(404, 'Not found')

    def _read_json(self):
        length = int(self.headers.get('Content-Length') or 0)
        raw = self.rfile.read(length) if length else b'{}'
        try:
            return json.loads(raw.decode('utf-8') or '{}')
        except json.JSONDecodeError:
            return None

    def _proxy_ex(self):
        payload = self._read_json()
        if not isinstance(payload, dict):
            return self._json_err(400, 'invalid json')
        url = str(payload.get('url') or '')
        method = str(payload.get('method') or 'GET').upper()
        if method not in ('GET', 'POST', 'DELETE', 'PUT'):
            return self._json_err(400, 'method not allowed')
        try:
            parsed = urlparse(url)
        except Exception:
            return self._json_err(400, 'bad url')
        if parsed.scheme not in ('https', 'http') or parsed.hostname not in ALLOWED_HOSTS:
            return self._json_err(403, 'host not allowed: %s' % (parsed.hostname,))

        # emergency mute: drop Telegram outbound (old browser tabs keep trying)
        if TG_MUTE and parsed.hostname == 'api.telegram.org' and '/sendMessage' in parsed.path:
            msg = json.dumps(
                {'ok': False, 'description': 'SCALP_TG_MUTE: telegram send blocked on server'}
            ).encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)
            return

        headers = payload.get('headers') or {}
        if not isinstance(headers, dict):
            headers = {}
        body = payload.get('body')
        data = None
        if body is not None and method != 'GET':
            if isinstance(body, (dict, list)):
                data = json.dumps(body).encode('utf-8')
            elif isinstance(body, str):
                data = body.encode('utf-8')
            elif isinstance(body, bytes):
                data = body
            else:
                data = str(body).encode('utf-8')

        req = urllib.request.Request(url, data=data, method=method)
        req.add_header('User-Agent', 'sCalp-local/1.0')
        for k, v in headers.items():
            if v is None:
                continue
            key = str(k)
            # block hop-by-hop / dangerous
            if key.lower() in ('host', 'content-length', 'connection'):
                continue
            req.add_header(key, str(v))
        if data is not None and not any(str(k).lower() == 'content-type' for k in headers):
            req.add_header('Content-Type', 'application/x-www-form-urlencoded')

        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                out = resp.read()
                self.send_response(resp.status)
                ctype = resp.headers.get('Content-Type', 'application/json')
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(out)))
                self.end_headers()
                self.wfile.write(out)
        except urllib.error.HTTPError as e:
            out = e.read() if e.fp else b''
            self.send_response(e.code)
            self.send_header('Content-Type', e.headers.get('Content-Type', 'application/json'))
            self.send_header('Content-Length', str(len(out)))
            self.end_headers()
            self.wfile.write(out)
        except Exception as e:
            msg = json.dumps({'msg': str(e)}).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def _json_err(self, code, msg):
        body = json.dumps({'msg': msg}).encode()
        self.send_response(code)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def _proxy_cg(self):
        path = self.path[3:]  # drop /cg
        if not path.startswith('/'):
            path = '/' + path
        url = CG_BASE + path
        key = self.headers.get('CG-API-KEY') or CG_KEY
        req = urllib.request.Request(url, headers={'User-Agent': 'sCalp-local/1.0'})
        if key:
            req.add_header('CG-API-KEY', key)
        try:
            with urllib.request.urlopen(req, timeout=30) as resp:
                body = resp.read()
                self.send_response(resp.status)
                ctype = resp.headers.get('Content-Type', 'application/json')
                self.send_header('Content-Type', ctype)
                self.send_header('Content-Length', str(len(body)))
                self.end_headers()
                self.wfile.write(body)
        except urllib.error.HTTPError as e:
            body = e.read() if e.fp else b''
            self.send_response(e.code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            self.wfile.write(body)
        except Exception as e:
            msg = ('{"code":"-1","msg":%s}' % repr(str(e))).encode()
            self.send_response(502)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(msg)))
            self.end_headers()
            self.wfile.write(msg)

    def log_message(self, fmt, *args):
        sys_stderr = __import__('sys').stderr
        sys_stderr.write('[%s] %s\n' % (self.log_date_time_string(), fmt % args))


def _lan_ips():
    import socket

    ips = []
    try:
        hostname = socket.gethostname()
        for info in socket.getaddrinfo(hostname, None, socket.AF_INET):
            ip = info[4][0]
            if ip and not ip.startswith('127.') and ip not in ips:
                ips.append(ip)
    except Exception:
        pass
    if not ips:
        try:
            s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
            s.connect(('8.8.8.8', 80))
            ips.append(s.getsockname()[0])
            s.close()
        except Exception:
            pass
    return ips


if __name__ == '__main__':
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(('0.0.0.0', PORT), Handler) as httpd:
        print('sCalp hub  http://127.0.0.1:%s/' % PORT)
        print('Terminal   http://127.0.0.1:%s/local/' % PORT)
        for ip in _lan_ips():
            print('Phone/Termux http://%s:%s/local/' % (ip, PORT))
        print('Coinglass proxy http://127.0.0.1:%s/cg/api/...' % PORT)
        print('Exchange proxy  POST http://127.0.0.1:%s/ex/forward' % PORT)
        httpd.serve_forever()
