import sys
from pathlib import Path


sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import server


def test_load_runtime_env_uses_root_key_when_backend_value_is_blank(tmp_path, monkeypatch):
    backend_dir = tmp_path / "backend"
    backend_dir.mkdir()
    (backend_dir / ".env").write_text("ELEVENLABS_API_KEY=\n")
    (tmp_path / ".env").write_text("ELEVENLABS_API_KEY=from-root\n")
    monkeypatch.delenv("ELEVENLABS_API_KEY", raising=False)
    monkeypatch.setattr(server, "BASE_DIR", backend_dir)
    monkeypatch.setattr(server, "REPO_ROOT", tmp_path)

    server.load_runtime_env()

    assert server.os.environ["ELEVENLABS_API_KEY"] == "from-root"
