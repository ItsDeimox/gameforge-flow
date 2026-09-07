from pathlib import Path
import sys

SERVER_ROOT = str(Path(__file__).resolve().parent)
if SERVER_ROOT not in sys.path:
    sys.path.insert(0, SERVER_ROOT)

from team_server import *


if __name__ == "__main__":
    main()
