#!/usr/bin/env python3
import http.server
import socketserver
import os
import sys

PORT = 8856

class DualPathHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', '*')
        self.send_header('Cache-Control', 'no-cache, no-store, must-revalidate')
        super().end_headers()

    def guess_type(self, path):
        if path.endswith('.glb'):
            return 'model/gltf-binary'
        if path.endswith('.gltf'):
            return 'model/gltf+json'
        if path.endswith('.js'):
            return 'application/javascript'
        return super().guess_type(path)

def run():
    script_dir = os.path.dirname(os.path.abspath(__file__))
    project_root = os.path.abspath(os.path.join(script_dir, "..", ".."))
    os.chdir(project_root)
    
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), DualPathHTTPRequestHandler) as httpd:
        print(f"PAIR Lab 3D Viewer Server listening on http://localhost:{PORT}/tools/viewer/")
        sys.stdout.flush()
        httpd.serve_forever()

if __name__ == '__main__':
    run()
