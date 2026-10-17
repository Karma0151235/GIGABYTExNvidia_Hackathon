import importlib.util
from pathlib import Path


SCRIPT = Path(__file__).with_name("generate_voice_samples.py")


def test_sample_manifest_has_unique_mp3_filenames():
    spec = importlib.util.spec_from_file_location("voice_samples", SCRIPT)
    module = importlib.util.module_from_spec(spec)
    assert spec.loader is not None
    spec.loader.exec_module(module)

    filenames = [filename for filename, _ in module.SAMPLES]
    assert len(filenames) == 14
    assert len(filenames) == len(set(filenames))
    assert all(filename.endswith(".mp3") for filename in filenames)
