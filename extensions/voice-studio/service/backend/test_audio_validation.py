import struct
import unittest

from audio_validation import MAX_AUDIO_BYTES, valid_wav


def wav_bytes(
    samples: bytes = b"\x00\x00",
    *,
    audio_format: int = 1,
    channels: int = 1,
    sample_rate: int = 48_000,
    byte_rate: int = 96_000,
    block_align: int = 2,
    bits_per_sample: int = 16,
) -> bytes:
    fmt = struct.pack(
        "<HHIIHH",
        audio_format,
        channels,
        sample_rate,
        byte_rate,
        block_align,
        bits_per_sample,
    )
    data_chunk = b"data" + struct.pack("<I", len(samples)) + samples
    if len(samples) % 2:
        data_chunk += b"\x00"
    body = b"WAVE" + b"fmt " + struct.pack("<I", len(fmt)) + fmt + data_chunk
    return b"RIFF" + struct.pack("<I", len(body)) + body


class WavValidationTests(unittest.TestCase):
    def test_accepts_a_bounded_pcm_wav(self):
        self.assertTrue(valid_wav(wav_bytes()))

    def test_rejects_bytes_after_the_declared_riff_boundary(self):
        self.assertFalse(valid_wav(wav_bytes() + b"trailing"))

    def test_rejects_truncated_or_empty_audio(self):
        self.assertFalse(valid_wav(wav_bytes()[:-1]))
        self.assertFalse(valid_wav(wav_bytes(b"")))

    def test_rejects_output_above_the_limit(self):
        self.assertFalse(valid_wav(b"RIFF" + b"\x00" * MAX_AUDIO_BYTES))

    def test_rejects_non_pcm16_mono_48khz_output(self):
        self.assertFalse(valid_wav(wav_bytes(audio_format=3)))
        self.assertFalse(valid_wav(wav_bytes(channels=2, block_align=4, byte_rate=192_000)))
        self.assertFalse(valid_wav(wav_bytes(sample_rate=44_100, byte_rate=88_200)))
        self.assertFalse(valid_wav(wav_bytes(bits_per_sample=24, block_align=3, byte_rate=144_000)))

    def test_rejects_inconsistent_rate_alignment_and_sample_bytes(self):
        self.assertFalse(valid_wav(wav_bytes(byte_rate=48_000)))
        self.assertFalse(valid_wav(wav_bytes(block_align=4)))
        self.assertFalse(valid_wav(wav_bytes(samples=b"\x00")))


if __name__ == "__main__":
    unittest.main()