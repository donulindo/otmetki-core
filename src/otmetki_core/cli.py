"""Commands for local data, tests and a loopback demo. No deployment credentials."""

import argparse
import json
from pathlib import Path

from .api import LocalServer
from .context import context_txt
from .demo import seed_demo
from .store import Store


def main() -> None:
    parser = argparse.ArgumentParser(description="Otmetki Core local educational demo")
    parser.add_argument("--database", default=".data/demo.sqlite3")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("init")
    commands.add_parser("demo")
    serve = commands.add_parser("serve")
    serve.add_argument("--port", type=int, default=8088)
    export = commands.add_parser("context")
    export.add_argument("material_ids", nargs="+")
    export.add_argument("--output", type=Path)
    args = parser.parse_args()
    if args.command == "serve":
        server = LocalServer(("127.0.0.1", args.port), args.database)
        port = server.server_address[1]
        print(f"Local synthetic-data demo: http://127.0.0.1:{port}", flush=True)
        try:
            server.serve_forever()
        except KeyboardInterrupt:
            pass
        finally:
            server.server_close()
        return
    with Store(args.database) as store:
        if args.command == "demo":
            print(json.dumps(seed_demo(store), ensure_ascii=False, indent=2))
        elif args.command == "context":
            content = context_txt(store.context_materials([{"id": material_id} for material_id in args.material_ids]))
            if args.output:
                args.output.write_text(content, encoding="utf-8")
            else:
                print(content, end="")
        else:
            print("Educational database initialized.")
