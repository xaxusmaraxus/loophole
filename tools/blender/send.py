"""Run a script in the open Blender through the BlenderMCP addon socket (port 9876).

    python3 tools/blender/send.py art/blender/guest_01.py

The script gets REPO (repo root) as a global. Prints Blender's result.
"""
import json, os, socket, sys

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
path = os.path.abspath(sys.argv[1])
code = "REPO = %r\nexec(compile(open(%r).read(), %r, 'exec'), {'REPO': REPO, '__name__': '__main__'})" % (REPO, path, path)
s = socket.create_connection(("127.0.0.1", int(os.environ.get("BLENDER_PORT", 9876))), timeout=300)
s.sendall(json.dumps({"type": "execute_code", "params": {"code": code}}).encode())
buf = b""
while True:
    chunk = s.recv(65536)
    if not chunk:
        break
    buf += chunk
    try:
        reply = json.loads(buf)
        break
    except ValueError:
        continue
if reply.get("status") == "success":
    print("\n".join(l for l in reply["result"].get("result", "").splitlines() if "INFO" not in l))
else:
    msg = reply.get("message", "")
    try:
        msg = json.loads(msg).get("traceback", msg)
    except ValueError:
        pass
    print("BLENDER ERROR:", msg[-2500:])
sys.exit(0 if reply.get("status") == "success" else 1)
