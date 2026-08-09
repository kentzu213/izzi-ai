import sys
import types
import unittest
from unittest.mock import patch

import model_runtime


class ModelRuntimeTests(unittest.TestCase):
    def _guarded_hub(self):
        calls = []

        def download(repo_id, *args, **kwargs):
            calls.append((repo_id, args, kwargs))
            return "/cache/artifact"

        fake = types.SimpleNamespace(hf_hub_download=download)
        with patch.dict(sys.modules, {"huggingface_hub": fake}):
            model_runtime.install_huggingface_revision_guard()
        return fake, calls

    def test_revision_guard_forces_the_approved_commit(self):
        fake, calls = self._guarded_hub()
        result = fake.hf_hub_download(model_runtime.MODEL_REPO, "config.json")
        self.assertEqual(result, "/cache/artifact")
        self.assertEqual(calls[0][2]["revision"], model_runtime.MODEL_REVISION)

    def test_revision_guard_rejects_drift_and_unknown_repositories(self):
        fake, _calls = self._guarded_hub()
        with self.assertRaisesRegex(RuntimeError, "model_revision_mismatch"):
            fake.hf_hub_download(model_runtime.CODEC_REPO, revision="main")
        with self.assertRaisesRegex(RuntimeError, "unapproved_model_repository"):
            fake.hf_hub_download("someone/else")

    def test_local_contract_requires_exact_sdk_and_preset_catalog(self):
        with (
            patch("model_runtime.installed_sdk_version", return_value=model_runtime.PINNED_SDK_VERSION),
            patch("model_runtime.preset_catalog_sha256", return_value=model_runtime.PRESET_CATALOG_SHA256),
        ):
            model_runtime.verify_local_runtime_contract()

        with (
            patch("model_runtime.installed_sdk_version", return_value="3.2.4"),
            self.assertRaisesRegex(RuntimeError, "sdk_version_mismatch"),
        ):
            model_runtime.verify_local_runtime_contract()

    def test_loader_installs_revision_guard_before_import_sensitive_checks(self):
        events = []
        engine = object()
        fake_vieneu = types.SimpleNamespace(
            Vieneu=lambda **kwargs: events.append(("engine", kwargs)) or engine,
        )

        with (
            patch(
                "model_runtime.install_huggingface_revision_guard",
                side_effect=lambda: events.append("guard"),
            ),
            patch(
                "model_runtime.verify_local_runtime_contract",
                side_effect=lambda: events.append("verify"),
            ),
            patch.dict(sys.modules, {"vieneu": fake_vieneu}),
        ):
            self.assertIs(model_runtime.load_pinned_engine(), engine)

        self.assertEqual(events[0:2], ["guard", "verify"])
        self.assertEqual(
            events[2],
            ("engine", {"mode": "v3turbo", "backend": "onnx", "device": "cpu"}),
        )


if __name__ == "__main__":
    unittest.main()
