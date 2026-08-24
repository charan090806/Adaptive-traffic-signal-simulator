"""
Standalone Local Python HTTP Server Launcher for the Web Traffic Simulator & Dashboard.
"""

import http.server
import socketserver
import webbrowser
import os
import sys

PORT = 8000
base_dir = os.path.dirname(os.path.abspath(__file__))
if os.path.exists(os.path.join(base_dir, "web_simulator", "dist")):
    WEB_DIR = os.path.join(base_dir, "web_simulator", "dist")
else:
    WEB_DIR = os.path.join(base_dir, "web_simulator")


class CustomHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=WEB_DIR, **kwargs)

def launch_server(start_port=PORT):
    socketserver.TCPServer.allow_reuse_address = True
    port = start_port
    httpd = None

    while port < start_port + 20:
        try:
            httpd = socketserver.TCPServer(("", port), CustomHTTPRequestHandler)
            break
        except OSError:
            print(f"Port {port} is already in use, trying port {port + 1}...")
            port += 1

    if not httpd:
        print(f"Error: Could not bind to any port between {start_port} and {start_port + 20}.")
        sys.exit(1)

    print("==================================================================")
    print(f" Starting Smart Traffic AI Web Simulator Server...")
    print(f" Web Simulator Folder: {WEB_DIR}")
    print(f" Local URL: http://localhost:{port}")
    print(f" Server is running on port {port}. Press Ctrl+C to stop.")
    print("==================================================================")

    url = f"http://localhost:{port}"
    try:
        webbrowser.open(url)
    except Exception as e:
        print(f"Could not auto-open browser ({e}). Please open {url} in your browser.")

    with httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nShutting down Web Server.")
            sys.exit(0)

if __name__ == "__main__":
    launch_server()

