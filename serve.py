# serve.py — локальний сервер гри (python3 serve.py [порт], типово 8123): як python3 -m http.server, але з
# Cache-Control: no-cache — браузер щоразу перевіряє файли (не змінились — коротка відповідь 304). Без заголовка Chrome
# кешує файл без перевірки на 10 % його віку (давно не змінений модуль — на години), тож після змін коду гра й worker
# генерації брали старі модулі навіть після перезавантаження сторінки (11.10.2026)
import http.server
import sys


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()

    def log_message(self, *args):
        pass


port = int(sys.argv[1]) if len(sys.argv) > 1 else 8123
# WebGPU браузер дає лише на захищених адресах — посилання на localhost, не 0.0.0.0
print(f'Відлуння: http://localhost:{port}/', flush=True)
http.server.ThreadingHTTPServer(('', port), Handler).serve_forever()
