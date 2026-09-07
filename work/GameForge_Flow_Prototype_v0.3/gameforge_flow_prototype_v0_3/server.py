from http.server import ThreadingHTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
import webbrowser, threading, os

ROOT = Path(__file__).resolve().parent
os.chdir(ROOT)

HOST = "0.0.0.0"
PORT = 8765

def open_browser():
    webbrowser.open(f"http://localhost:{PORT}")

if __name__ == "__main__":
    print(f"\nGameForge Flow rodando em http://localhost:{PORT}")
    print("Na próxima etapa, este host pode ser exposto pela LAN/Radmin.\n")
    threading.Timer(0.7, open_browser).start()
    ThreadingHTTPServer((HOST, PORT), SimpleHTTPRequestHandler).serve_forever()
