# syntax=docker/dockerfile:1
# Izzi Voice TTS - FastAPI wrapper around VieNeu-TTS. CPU/ONNX, on-device.
FROM python:3.11-slim@sha256:db3ff2e1800a8581e2c48a27c3995339d47bdf046da21c7627accd3d51053a93 AS runtime

WORKDIR /app

RUN apt-get update \
  && apt-get install -y --no-install-recommends libgomp1 libsndfile1 \
  && rm -rf /var/lib/apt/lists/*

COPY requirements.txt requirements.lock vieneu_dependency_compat.py ./
RUN pip install --no-cache-dir --only-binary=:all: --require-hashes --no-deps -r requirements.lock \
    && python vieneu_dependency_compat.py \
    && python -m pip check \
    && python -m pip uninstall --yes pip setuptools

COPY app.py audio_validation.py model_runtime.py ./

ARG SOURCE_REVISION=unknown
ARG BACKEND_TREE_SHA256=unknown
LABEL org.opencontainers.image.source="https://github.com/kentzu213/izzi-ai" \
      org.opencontainers.image.revision="${SOURCE_REVISION}" \
      io.izzi.voice.backend-tree-sha256="${BACKEND_TREE_SHA256}" \
      io.izzi.voice.sdk="vieneu==3.2.3" \
      io.izzi.voice.model-revision="75ff82a72f54d55ed389e1eeb12041d3c4bac7d4" \
      io.izzi.voice.codec-revision="ceff0d0749bfb3fa2d61149794ec6feef0d1e1ae" \
      io.izzi.voice.watermark="disabled"

ENV HF_HOME=/models VIENEU_CACHE=/models
EXPOSE 5111

FROM runtime AS test
COPY test_app.py test_audio_validation.py test_model_runtime.py test_vieneu_dependency_compat.py ./
RUN python -m unittest -v \
    test_audio_validation.py \
    test_model_runtime.py \
    test_vieneu_dependency_compat.py \
    test_app.py \
    && touch /tmp/izzi-voice-tests-passed

FROM runtime AS final
COPY --from=test /tmp/izzi-voice-tests-passed /opt/izzi/voice-tests-passed
CMD ["uvicorn", "app:app", "--host", "0.0.0.0", "--port", "5111"]
