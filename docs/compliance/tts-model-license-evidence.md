# CMR-007 — TTS model license evidence

Evidence date: **2026-07-27**
Reviewer: Socrates — **APPROVE**, recorded as LICENSE_VERIFIED + TEST_VERIFIED at local scope
(pre-commit; this sign-off does not extend to registry, CI or production).
Scope: which text-to-speech provider Starizzi may use for **commercial** Customer Marketing
video render/publish, and which may only be used non-commercially.

Machine-checked half of this document:
`apps/desktop/src/main/customer-marketing/commercial-voice-license.ts`
(`APPROVED_COMMERCIAL_VOICE_MODELS`). Keep both in sync — a model is only commercially
usable when it appears in that registry AND the runtime declares matching evidence.

## Verdict

| Provider | Checkpoint | License | `commercial_use_allowed` |
|---|---|---|---|
| VieNeu-TTS (Voice Studio) | `pnnbao-ump/VieNeu-TTS-v3-Turbo@<pinned revision required>` | Apache-2.0 | **true** |
| F5-TTS (ViVoice) | `hynt/F5-TTS-Vietnamese-ViVoice@50228ccc563853f0ac628f49ed99a11f653d9ebe` | CC-BY-NC-SA-4.0 | **false** |

## Approved: VieNeu-TTS v3 Turbo (Voice Studio)

Runtime path: `extensions/voice-studio/service/backend/app.py` installs the `vieneu` SDK
(`requirements.txt`) and constructs `Vieneu()`, which defaults to **VieNeu-TTS v3 Turbo**.
The backend runs on the operator's machine (CPU/ONNX), so no audio leaves the host.

Model, codec and G2P chain — the components that carry weights or linguistic data:

| Component | Role | License | Source |
|---|---|---|---|
| `pnnbao97/VieNeu-TTS` | project code / SDK | Apache-2.0 | <https://github.com/pnnbao97/VieNeu-TTS> |
| `vieneu` (PyPI, pinned `==3.2.3`) | distributed SDK package | Apache-2.0 (PyPI classifier) | <https://pypi.org/project/vieneu/> |
| `pnnbao-ump/VieNeu-TTS-v3-Turbo` | checkpoint package | Apache-2.0 | <https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo> |
| MOSS-Audio-Tokenizer-Nano | audio codec used by v3 Turbo | Apache-2.0 (MOSS-TTS family) | <https://github.com/OpenMOSS/MOSS-TTS> |
| `pnnbao97/sea-g2p` | text normalization / phonemization | Apache-2.0 (`LICENSE` file) | <https://raw.githubusercontent.com/pnnbao97/sea-g2p/main/LICENSE> |

Other runtime dependencies pulled by `vieneu` 3.2.3 on the default CPU path — `perth`,
`onnxruntime`, `soundfile`, `soxr`, `tokenizers`, `huggingface_hub`, `gradio` — are
conventional open-source Python packages and are not weight-bearing, with one behavioural
caveat below. The `neucodec` codec used by v1/v2 sits behind the `legacy` extra and is not
installed on this path.

**Watermarking caveat (material to marketing output):** `perth` is Resemble AI's PerTh
watermarker. Audio generated through this pipeline may carry an imperceptible watermark. That
is not a licence obstacle, but it is a property of the delivered audio and should be known
before shipping commercial spots.

Lineage note: v3 Turbo is a **from-scratch 48 kHz architecture**, so it does not inherit the
non-commercial restriction that applies to checkpoints fine-tuned from NeuTTS Air or from the
Emilia-trained F5 base. Earlier VieNeu v1/v2 checkpoints are fine-tuned from NeuTTS Air and are
deliberately **not** in the registry — their base lineage was not audited here.

Obligations carried forward (Apache-2.0 §4): keep the license notice and attribution for both
`pnnbao97/VieNeu-TTS` and `pnnbao-ump/VieNeu-TTS-v3-Turbo` when redistributing or converting
these assets. Bundling further third-party assets brings their own licenses along.

## Blocked: F5-TTS ViVoice

- F5-TTS **code** is MIT, but code license does not grant rights over model weights.
- The configured checkpoint is `hynt/F5-TTS-Vietnamese-ViVoice`
  (<https://huggingface.co/hynt/F5-TTS-Vietnamese-ViVoice>) and declares `CC-BY-NC-SA-4.0`.
  The sibling Vietnamese release from the same author states the same terms — non-commercial
  research use only (<https://huggingface.co/hynt/F5-TTS-Vietnamese-100h>). The upstream F5 base
  trained on Emilia is likewise CC-BY-NC, so fine-tunes stay non-commercial.
- `SA` (ShareAlike) adds a copyleft obligation on derivative works, an extra reason not to
  attach it to commercial marketing output.
- Host configuration is consistent with this finding: `STARIZZI_F5_TTS_MODEL_LICENSE` declares
  `CC-BY-NC-SA-4.0` and `STARIZZI_F5_TTS_COMMERCIAL_USE_ALLOWED` is `false`.

Permitted F5 use: local experiments, research, and internal non-commercial material. Not
permitted: advertising or any commercial Starizzi/IzziAPI render or publish.

## How the gate enforces this

`CustomerVideoStudioService.getToolchain()` sets `commercialRenderAvailable` only when the
HyperFrames runtime, Node, FFmpeg/FFprobe are ready **and** at least one voice provider clears
the commercial bar. Both provider slots (F5 and Voice Studio) require all of:

1. runtime installed and serving — for Voice Studio the host uses the managed-service health
   check (`healthPath: /health/ready` on the port actually allocated to the container), so
   neither a bare extension host nor an unrelated process on a fixed port counts as ready, and
   a checkpoint that is still loading (HTTP 503) does not count either;
2. `commercialUseAllowed` declared true by the runtime/env;
3. complete evidence — model id, model hash, license, license source;
4. no non-commercial marker in the license string;
5. `verifyCommercialVoiceLicense(evidence) === true`, which additionally requires:
   - provider + repository + license to match this registry;
   - the model id to carry a **pinned revision** (`repo@<hex>`) — a floating tag cannot be tied
     to the checkpoint that actually loads;
   - the model hash to be a full SHA-256;
   - the license source to be an HTTPS URL on an allowlisted documentation host.

Identity binding — what is and is not guaranteed:

- **Bytes cannot drift.** `docker-compose.izzi.yml` pins the service image by digest
  (`sha256:746cead1…295f`), so the running container is a fixed artifact rather than a moving
  `:latest`. Note this is a compose *default*: an operator who sets `VOICE_TTS_IMAGE` overrides
  it, so treat the digest as a safe default, not an enforcement boundary.
- **The SDK pin is forward-looking, not retroactive.** `requirements.txt` now pins
  `vieneu==3.2.3`, but the pinned image was built on 2026-07-10 while `vieneu` 3.2.3 was
  published on 2026-07-12 — that image therefore ships an **earlier** SDK build, produced when
  the requirement was unpinned. The pin only takes effect for the next published image.
  (Dates obtained from the `created` field of
  `docker buildx imagetools inspect ghcr.io/kentzu213/izzi-voice-tts:latest` and from the
  `vieneu` release history on PyPI — both re-checkable.)
- **Consequence to expect:** `/health/ready` reports the installed `sdk_version`, so it will
  currently report a version lower than 3.2.3. That is a known, explained mismatch, not a
  tampering signal. Before relying on the `==3.2.3` guarantee, republish the image from the
  pinned requirements, re-resolve the digest, and update this document.

Until the image is rebuilt, the licence conclusion still holds: every VieNeu SDK line in the
3.x series defaults to the v3 Turbo checkpoint audited above. The open item is provenance
precision, not a licence risk.

Declaring intent through env alone is not sufficient: before this change the verifier was not
wired in `apps/desktop/src/main/index.ts`, so the gate depended on a callback that never
existed. It is now wired to the audited registry, which means a mis-set
`*_COMMERCIAL_USE_ALLOWED=true` can no longer unlock a non-commercial checkpoint.

Render succeeding is still not permission to publish: publish/spend remain behind their own
CMR-402 approval gates.

## Operator setup for commercial render

Set these on the host (values are configuration, not secrets) and start Voice Studio:

```
STARIZZI_VOICE_STUDIO_PROVIDER=VieNeu-TTS
STARIZZI_VOICE_STUDIO_MODEL_ID=pnnbao-ump/VieNeu-TTS-v3-Turbo@<pinned upstream revision sha>
STARIZZI_VOICE_STUDIO_MODEL_SHA256=<full sha256 of the local checkpoint file>
STARIZZI_VOICE_STUDIO_MODEL_LICENSE=Apache-2.0
STARIZZI_VOICE_STUDIO_LICENSE_SOURCE=https://huggingface.co/pnnbao-ump/VieNeu-TTS-v3-Turbo
STARIZZI_VOICE_STUDIO_COMMERCIAL_USE_ALLOWED=true
```

**Per app session:** open Voice Studio once. The host only owns a readiness signal for a service
it booted in the current session, so after restarting Starizzi the container may still be running
while the gate reports "installed but not serving". That is deliberate fail-closed behaviour, not
a fault — opening the extension restores the signal.

## Re-check triggers

Re-verify this document when any of these change: the `vieneu` SDK default checkpoint, the
Voice Studio pinned model, upstream license terms, or the codec/G2P dependencies. Upstream
license text is a point-in-time fact — re-read it before relying on it again.

## Verification

- `commercial-voice-license.test.ts` — approved chain, NC rejection, unpinned-revision
  rejection, non-SHA-256 hash rejection, unknown repository, license mismatch, missing fields,
  license-source host/scheme (including `https://huggingface.co@evil.example`), NC marker
  detection, registry invariants, and the env→evidence→verifier wiring the Electron entry uses.
- `customer-video-studio-service.test.ts` — provider-agnostic gate: opens from Voice Studio
  evidence alone; stays closed for NC license, undeclared intent, incomplete evidence, missing
  verifier, a non-running runtime, or a readiness lookup that rejects.
- Suite state at sign-off: `src/main/customer-marketing/` 319/319; full desktop suite green;
  `tsc -p tsconfig.main.json --noEmit` clean; `vite build` clean.

## Known limitation

The gate verifies the operator's **declaration** against an audited registry and pins the SDK
and container image; it does not cryptographically attest the bytes the SDK downloads at
runtime. `STARIZZI_VOICE_STUDIO_MODEL_SHA256` is operator-supplied. Closing that fully requires
the backend to hash its loaded checkpoint and expose it for comparison — worth doing before any
high-volume commercial render programme.
