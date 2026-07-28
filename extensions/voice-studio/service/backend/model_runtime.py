"""Immutable VieNeu runtime provenance and loader guards."""

from __future__ import annotations

import hashlib
from importlib.metadata import version
from pathlib import Path
from typing import Any


PINNED_SDK_VERSION = "3.2.3"
MODEL_REPO = "pnnbao-ump/VieNeu-TTS-v3-Turbo"
MODEL_REVISION = "75ff82a72f54d55ed389e1eeb12041d3c4bac7d4"
CODEC_REPO = "OpenMOSS-Team/MOSS-Audio-Tokenizer-Nano-ONNX"
CODEC_REVISION = "ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae"
PRESET_CATALOG_SHA256 = "13f17165586ec132efd35076f46ec8de7f7e474a344e262c6360d89726eeb8d9"

APPROVED_REVISIONS = {
    MODEL_REPO: MODEL_REVISION,
    CODEC_REPO: CODEC_REVISION,
}


def installed_sdk_version() -> str:
    return version("vieneu")


def preset_catalog_path() -> Path:
    import vieneu

    return Path(vieneu.__file__).resolve().parent / "assets" / "voices_v3_turbo.json"


def preset_catalog_sha256() -> str:
    return hashlib.sha256(preset_catalog_path().read_bytes()).hexdigest()


def verify_local_runtime_contract() -> None:
    if installed_sdk_version() != PINNED_SDK_VERSION:
        raise RuntimeError("sdk_version_mismatch")
    if preset_catalog_sha256() != PRESET_CATALOG_SHA256:
        raise RuntimeError("preset_catalog_mismatch")


def install_huggingface_revision_guard() -> None:
    """Force every model artifact request onto an approved immutable revision."""
    import huggingface_hub

    current = huggingface_hub.hf_hub_download
    if getattr(current, "_izzi_revision_guard", False):
        if getattr(current, "_izzi_approved_revisions", None) != APPROVED_REVISIONS:
            raise RuntimeError("revision_guard_mismatch")
        return

    original = current

    def pinned_hf_hub_download(repo_id: str, *args: Any, **kwargs: Any):
        revision = APPROVED_REVISIONS.get(repo_id)
        if revision is None:
            raise RuntimeError("unapproved_model_repository")
        requested_revision = kwargs.get("revision")
        if requested_revision not in (None, revision):
            raise RuntimeError("model_revision_mismatch")
        kwargs["revision"] = revision
        return original(repo_id, *args, **kwargs)

    pinned_hf_hub_download._izzi_revision_guard = True  # type: ignore[attr-defined]
    pinned_hf_hub_download._izzi_approved_revisions = APPROVED_REVISIONS  # type: ignore[attr-defined]
    huggingface_hub.hf_hub_download = pinned_hf_hub_download


def load_pinned_engine():
    install_huggingface_revision_guard()
    verify_local_runtime_contract()

    from vieneu import Vieneu

    return Vieneu(mode="v3turbo", backend="onnx", device="cpu")
