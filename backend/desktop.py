import os
import socket
import sys
import threading
import time
import urllib.request
import webbrowser
from pathlib import Path

import uvicorn
from fastapi.staticfiles import StaticFiles


def main():
    data = Path(os.environ.get('SPLITEASE_DATA_DIR', str(Path(os.environ['LOCALAPPDATA']) / 'SplitEase')))
    data.mkdir(parents=True, exist_ok=True)
    os.environ['SPLITEASE_SQLITE_PATH'] = str(data / 'splitease.db')
    os.environ.setdefault('OCR_PROVIDER', 'mock')
    from app.local import app
    assets = Path(getattr(sys, '_MEIPASS', Path(__file__).parent)) / 'web'
    app.mount('/', StaticFiles(directory=assets, html=True), name='frontend')
    sock = socket.socket()
    sock.bind(('127.0.0.1', 0))
    port = sock.getsockname()[1]
    url = f'http://127.0.0.1:{port}'
    (data / 'last-url.txt').write_text(url, encoding='utf-8')
    def open_when_ready():
        for _ in range(100):
            try:
                urllib.request.urlopen(url + '/health', timeout=1).close()
                if os.environ.get('SPLITEASE_NO_BROWSER') != '1':
                    webbrowser.open(url)
                return
            except OSError:
                time.sleep(.1)
    threading.Thread(target=open_when_ready, daemon=True).start()
    print('SplitEase:', url, '\nClose this window to stop. Data:', data, flush=True)
    uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=port)).run(sockets=[sock])


if __name__ == '__main__':
    main()
