# 개발용 서버 — 브라우저가 옛 모듈을 붙잡지 않도록 캐시를 끈다. 실행: python serve.py
import http.server, functools
class H(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store')
        super().end_headers()
http.server.ThreadingHTTPServer(('127.0.0.1', 8731), H).serve_forever()
