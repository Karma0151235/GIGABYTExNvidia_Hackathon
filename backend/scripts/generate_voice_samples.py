"""Generate fictional Malaysian emergency-call MP3s for the live intake demo."""

from __future__ import annotations

import os
from pathlib import Path


ROOT = Path(__file__).resolve().parents[2]
OUTPUT_DIR = ROOT / "voice_samples"
VOICE_ID = "dNnVzcebCLVAswzGKvfO"

SAMPLES = [
    ("01_p1_bm_klcc_cardiac.mp3", "Tolong cepat, dekat KLCC concourse bawah. Ayah saya tiba-tiba jatuh, dia tak sedar. Nafas macam susah sangat. Orang ramai dah tolong tapi dia tak respon."),
    ("02_p1_manglish_jalan_tun_razak_collision.mp3", "Hello 999 ah, accident teruk dekat Jalan Tun Razak underpass. Motor kena kereta, rider tu tak bergerak lah. Banyak darah dekat kepala, please send ambulance cepat."),
    ("03_p1_english_kl_sentral_collapse.mp3", "Please, please send someone to KL Sentral. My husband collapsed near the main entrance. He said chest pain, then he fell down. He's not answering me properly."),
    ("04_p2_bm_cheras_fall.mp3", "Saya dekat Cheras, luar stesen MRT. Seorang perempuan jatuh tangga, kaki dia nampak macam patah. Dia sedar, tapi sakit sangat dan tak boleh bangun."),
    ("05_p2_manglish_bukit_bintang_gas_leak.mp3", "Dekat Bukit Bintang, belakang restoran, bau gas kuat gila. Staff semua keluar already, dua orang pening dan muntah sikit. Tak ada api yet, but please cepat."),
    ("06_p2_mandarin_kl_sentral_fall.mp3", "救护车可以来 KL Sentral 吗？一个老人家跌倒了，手臂可能断了。Dia masih sedar, tapi sakit sangat, tak boleh gerak。"),
    ("07_p1_tamil_sunway_breathing.mp3", "Sunway area, please ambulance. என் அம்மாவுக்கு மூச்சு விட முடியல. She cannot breathe properly, face already very pale. We are outside the mall entrance."),
    ("08_p2_bm_masjid_jamek_flood.mp3", "Dekat Masjid Jamek, air naik cepat. Ada kereta tersangkut, dalam tu ada mak dengan dua anak kecil. Mereka takut nak keluar sebab arus kuat."),
    ("09_p3_manglish_bangsar_bicycle_fall.mp3", "Sorry, I'm not sure emergency or not. Dekat Bangsar, my friend jatuh basikal. Dia conscious, no heavy bleeding, but tangan dia sakit and maybe cannot move."),
    ("10_p1_bm_jalan_tun_razak_duplicate.mp3", "Saya nampak kemalangan dekat Jalan Tun Razak, bawah jejambat. Kereta terbalik, ada asap keluar. Saya tak pasti berapa orang dalam, tapi seorang dekat jalan macam pengsan."),
    ("11_p1_manglish_petaling_jaya_stroke.mp3", "We're in Petaling Jaya. My uncle suddenly cannot talk properly, his face senget one side. He's awake but very confused. Is this stroke? Please come fast."),
    ("12_p2_tamil_titiwangsa_collision.mp3", "Titiwangsa dekat roundabout, motosikal accident. ஒருவர் jalan atas, dia sedar lagi but bleeding dekat leg. Ambulans cepat boleh?"),
    # Non-emergency fixtures, made locally (ffmpeg pink noise / macOS `say`), never sent to TTS.
    ("13_silent_open_line.mp3", ""),
    ("14_spam_prank_call.mp3", "Ha ha ha, hello nine nine nine? This is a prank call lah. Saja test line, just kidding, bye."),
]


def load_env(path: Path) -> None:
    if not path.exists():
        return
    for line in path.read_text().splitlines():
        key, separator, value = line.strip().partition("=")
        if separator and key and not key.startswith("#"):
            os.environ.setdefault(key, value.strip().strip('"').strip("'"))


def main() -> None:
    load_env(ROOT / ".env.local")
    load_env(ROOT / ".env")
    api_key = os.environ.get("ELEVENLABS_API_KEY")
    if not api_key:
        raise SystemExit("Set ELEVENLABS_API_KEY in .env.local before generating voice samples.")

    from elevenlabs.client import ElevenLabs

    OUTPUT_DIR.mkdir(exist_ok=True)
    client = ElevenLabs(api_key=api_key)
    generated = 0
    for filename, text in SAMPLES:
        destination = OUTPUT_DIR / filename
        if destination.exists() or filename.startswith(("13_", "14_")):
            continue
        audio = client.text_to_speech.convert(
            voice_id=VOICE_ID,
            model_id="eleven_v3",
            output_format="mp3_44100_128",
            text=text,
        )
        with destination.open("wb") as file:
            for chunk in audio:
                file.write(chunk)
        generated += 1
        print(f"Saved {destination.relative_to(ROOT)}")
    print(f"Generated {generated} sample(s); {len(SAMPLES) - generated} already existed.")


if __name__ == "__main__":
    main()
