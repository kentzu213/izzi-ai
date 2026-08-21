import React, { useEffect, useState } from 'react';
import {
  getModelCreditPolicy,
  MODEL_CREDIT_NOTICE_VI,
} from '../../shared/model-credit-policy';
import {
  LOCAL_COCKPIT_BASE_URL,
  LOCAL_COCKPIT_LABEL,
  LOCAL_COCKPIT_MODEL,
  LOCAL_COCKPIT_REASONING_EFFORT,
} from '../../shared/local-cockpit';
import { useAgentGatewayStore } from '../store/agentGateway';

type AuthType = 'bearer' | 'x-api-key';

interface Preset {
  id: string;
  label: string;
  icon: string;
  baseUrl: string;
  model: string;
  authType: AuthType;
  hint: string;
}

// Known local OpenAI-compatible routers + a free-form custom option.
const PRESETS: Preset[] = [
  {
    id: 'cockpit',
    label: LOCAL_COCKPIT_LABEL,
    icon: '🖥️',
    baseUrl: LOCAL_COCKPIT_BASE_URL,
    model: LOCAL_COCKPIT_MODEL,
    authType: 'bearer',
    hint: 'Cockpit API Service chạy local ở cổng 51226 và phân phối model qua chuẩn OpenAI-compatible.',
  },
  {
    id: 'izzi-direct',
    label: 'Izzi API (hosted)',
    icon: '☁️',
    baseUrl: 'https://api.izziapi.com/v1',
    model: 'izzi-smart',
    authType: 'x-api-key',
    hint: 'Dùng trực tiếp Izzi API không cần router local. Chọn izzi-smart để SmartRouter tự route, hoặc đổi sang grok-4.5-high / gpt-5.6-sol để gọi thẳng.',
  },
  {
    id: '9router',
    label: '9router / LiteLLM (local)',
    icon: '🔀',
    baseUrl: 'http://127.0.0.1:4000/v1',
    model: 'gcli/grok-4.5-high',
    authType: 'bearer',
    hint: '9router/LiteLLM thường chạy ở cổng 4000 — sửa lại Base URL nếu bạn dùng cổng khác. Dùng master key của 9router.',
  },
  {
    id: 'custom',
    label: 'Tùy chỉnh',
    icon: '🔌',
    baseUrl: '',
    model: '',
    authType: 'bearer',
    hint: 'Bất kỳ endpoint OpenAI-compatible nào. Dùng https, hoặc http nếu endpoint chạy trên localhost/127.0.0.1.',
  },
];

type ReasoningEffort = 'minimal' | 'low' | 'medium' | 'high';

interface CustomProviderApi {
  getConfig: () => Promise<{
    config: {
      baseUrl: string;
      authType: AuthType;
      selectedModel: string;
      reasoningEffort?: ReasoningEffort;
    } | null;
    enabled: boolean;
    hasKey: boolean;
    maskedKeyHint: string | null;
  }>;
  saveConfig: (input: {
    baseUrl: string;
    authType: AuthType;
    selectedModel: string;
    reasoningEffort?: ReasoningEffort;
    apiKey?: string;
  }) => Promise<{ ok: boolean; errors?: string[] }>;
  setEnabled: (enabled: boolean) => Promise<unknown>;
  autoConnectLocal: () => Promise<{ ok: boolean; enabled?: boolean; reason?: string }>;
  testConnection: (input?: { apiKey?: string }) => Promise<{ ok: boolean; model?: string; message?: string }>;
}

function getApi(): CustomProviderApi | undefined {
  if (typeof window === 'undefined') return undefined;
  return (window as unknown as { electronAPI?: { customProvider?: CustomProviderApi } }).electronAPI
    ?.customProvider;
}

export function ModelConnectionsPage() {
  const api = getApi();
  const routeExternalSessionsToCustom = useAgentGatewayStore((state) => state.routeExternalSessionsToCustom);
  const enableCustomRouting = useAgentGatewayStore((state) => state.enableCustomRouting);
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [authType, setAuthType] = useState<AuthType>('bearer');
  // Optional stored reasoning effort — preserved through save; main-process
  // defaulting (high for gpt-5.6-sol) applies when unset.
  const [reasoningEffort, setReasoningEffort] = useState<ReasoningEffort | undefined>(undefined);
  const [apiKey, setApiKey] = useState('');
  const [enabled, setEnabled] = useState(false);
  const [hasKey, setHasKey] = useState(false);
  const [maskedHint, setMaskedHint] = useState<string | null>(null);
  const [presetId, setPresetId] = useState('cockpit');
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);

  useEffect(() => {
    if (!api?.getConfig) return;
    void (async () => {
      try {
        const c = await api.getConfig();
        if (c?.config) {
          const configuredBaseUrl = c.config.baseUrl || '';
          setBaseUrl(configuredBaseUrl);
          const configuredPreset = PRESETS.find((preset) => preset.baseUrl === configuredBaseUrl);
          setPresetId(configuredPreset?.id ?? 'custom');
          setModel(c.config.selectedModel || '');
          setAuthType(c.config.authType || 'bearer');
          setReasoningEffort(c.config.reasoningEffort);
        }
        setEnabled(!!c?.enabled);
        setHasKey(!!c?.hasKey);
        setMaskedHint(c?.maskedKeyHint ?? null);
      } catch {
        /* ignore — first run / no bridge */
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function applyPreset(p: Preset) {
    setPresetId(p.id);
    if (p.id !== 'custom') {
      setBaseUrl(p.baseUrl);
      if (p.model) setModel(p.model);
      setAuthType(p.authType);
    }
  }

  async function refreshKeyState() {
    if (!api?.getConfig) return;
    try {
      const c = await api.getConfig();
      setHasKey(!!c?.hasKey);
      setMaskedHint(c?.maskedKeyHint ?? null);
    } catch {
      /* ignore */
    }
  }

  async function persist(): Promise<boolean> {
    if (!api?.saveConfig) return false;
    const save = await api.saveConfig({
      baseUrl: baseUrl.trim(),
      authType,
      selectedModel: model.trim(),
      reasoningEffort,
      apiKey: apiKey.trim() || undefined,
    });
    if (!save?.ok) {
      setNotice({ ok: false, text: 'Cấu hình chưa hợp lệ: ' + (save?.errors?.join(', ') || 'kiểm tra Base URL / Model') });
      return false;
    }
    return true;
  }

  async function handleTest() {
    if (!api?.testConnection) return;
    setBusy(true);
    setNotice(null);
    try {
      // Saving the edited endpoint/key replaces the live config, so an already
      // enabled connection must go off first — a broken save never serves traffic.
      await api.setEnabled(false);
      setEnabled(false);
      if (!(await persist())) return;
      const r = await api.testConnection(apiKey.trim() ? { apiKey: apiKey.trim() } : undefined);
      setNotice(
        r?.ok
          ? { ok: true, text: `Kết nối OK (model ${r.model ?? model.trim()})` }
          : { ok: false, text: r?.message || 'Kết nối thất bại' },
      );
      setApiKey('');
      await refreshKeyState();
    } catch {
      setNotice({ ok: false, text: 'Lỗi khi kiểm tra kết nối' });
    } finally {
      setBusy(false);
    }
  }

  async function handleQuickConnect() {
    if (!api?.autoConnectLocal) return;
    setBusy(true);
    setNotice(null);
    try {
      const r = await api.autoConnectLocal();
      if (r?.ok) {
        setPresetId('cockpit');
        setBaseUrl(LOCAL_COCKPIT_BASE_URL);
        setModel(LOCAL_COCKPIT_MODEL);
        setAuthType('bearer');
        setReasoningEffort(LOCAL_COCKPIT_REASONING_EFFORT);
        setEnabled(true);
        routeExternalSessionsToCustom(LOCAL_COCKPIT_MODEL);
        await refreshKeyState();
        setNotice({
          ok: true,
          text: 'Đã kết nối Cockpit local với GPT-5.6 Sol (high). Agent ngoài Izzi sẽ dùng tuyến này ngay.',
        });
      } else if (r?.reason === 'no-env-key' || r?.reason === 'no-local-key') {
        setNotice({
          ok: false,
          text: 'Không thấy khóa local của Cockpit. Mở Cockpit, kiểm tra API Service rồi thử lại.',
        });
      } else if (r?.reason === 'connection-failed') {
        setNotice({
          ok: false,
          text: 'Cockpit chưa chấp nhận khóa local hiện tại. Chạy kiểm tra tuyến Cockpit rồi thử lại.',
        });
      } else {
        setNotice({ ok: false, text: 'Không kết nối nhanh được. Thử dán key thủ công rồi "Lưu & Bật".' });
      }
    } catch {
      setNotice({ ok: false, text: 'Lỗi khi kết nối nhanh' });
    } finally {
      setBusy(false);
    }
  }

  async function handleSaveEnable() {
    if (!api?.saveConfig) return;
    setBusy(true);
    setNotice(null);
    try {
      // The connection may already be enabled with the previous config: turn it
      // off before saving so the unproven endpoint/key never serves traffic.
      await api.setEnabled(false);
      setEnabled(false);
      if (!(await persist())) return;
      // Save alone proves nothing: the connection is only enabled and the agent
      // sessions are only rerouted after an authenticated probe succeeds.
      const routed = await enableCustomRouting(model.trim());
      setApiKey('');
      await refreshKeyState();
      if (!routed.ok) {
        setEnabled(false);
        setNotice({
          ok: false,
          text: `Đã lưu nhưng CHƯA bật: kết nối thất bại (${routed.message || 'không kết nối được endpoint'}). Kiểm tra endpoint/API key rồi thử lại.`,
        });
        return;
      }
      setEnabled(true);
      setNotice({ ok: true, text: 'Đã lưu & bật. Mở tab Chat agent — tin nhắn sẽ đi qua endpoint này.' });
    } catch {
      setNotice({ ok: false, text: 'Lỗi khi lưu' });
    } finally {
      setBusy(false);
    }
  }

  async function toggleEnabled() {
    if (!api?.setEnabled) return;
    const next = !enabled;
    setBusy(true);
    try {
      if (next) {
        // Turning the connection back on is also a probe-gated path.
        const routed = await enableCustomRouting(model.trim());
        if (!routed.ok) {
          setEnabled(false);
          setNotice({
            ok: false,
            text: `Chưa bật được: kết nối thất bại (${routed.message || 'không kết nối được endpoint'}).`,
          });
          return;
        }
        setEnabled(true);
        setNotice({ ok: true, text: 'Đã bật kết nối' });
        return;
      }
      await api.setEnabled(false);
      setEnabled(false);
      setNotice({ ok: true, text: 'Đã tắt — chat quay lại luồng agent mặc định' });
    } catch {
      setNotice({ ok: false, text: 'Không đổi được trạng thái' });
    } finally {
      setBusy(false);
    }
  }

  if (!api) {
    return (
      <div className="model-conn">
        <p className="model-conn__browser">Mở trong app Izzi (Electron) để cấu hình kết nối model.</p>
      </div>
    );
  }

  const activePreset = PRESETS.find((p) => p.id === presetId) ?? PRESETS[0];
  const isIzziBilledConnection =
    /^https:\/\/(api\.)?izziapi\.com\/v1(?:\/|$)/i.test(baseUrl.trim());
  const modelCreditPolicy =
    isIzziBilledConnection ? getModelCreditPolicy(model) : 'standard';

  return (
    <div className="model-conn">
      <header className="page-header">
        <div className="page-header__eyebrow">Model connections</div>
        <h1 className="page-header__title">Kết nối Model</h1>
        <p className="page-header__subtitle">
          Nối app tới endpoint OpenAI-compatible local hoặc hosted (codex-lb, 9router, Izzi API direct). Khi bật,
          mọi cuộc chat agent sẽ đi qua endpoint này thay vì phụ thuộc container.
        </p>
      </header>

      {enabled && (
        <div className="model-conn__status model-conn__status--on">
          ● Đang bật — chat đi qua <code>{baseUrl || '(chưa đặt Base URL)'}</code>
          {hasKey ? '' : ' · ⚠️ chưa có API key'}
        </div>
      )}

      <div className="model-conn__quick">
        <div className="model-conn__quick-text">
          <b>Kết nối nhanh Cockpit (local)</b>
          <span>Dùng khóa gateway đã chiếu trên máy và bật GPT-5.6 Sol (high).</span>
        </div>
        <button
          type="button"
          className="btn btn--primary"
          disabled={busy}
          onClick={() => void handleQuickConnect()}
        >
          🔌 Kết nối nhanh
        </button>
      </div>

      <div className="model-conn__presets">
        {PRESETS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`model-conn__preset ${presetId === p.id ? 'model-conn__preset--active' : ''}`}
            onClick={() => applyPreset(p)}
          >
            <span className="model-conn__preset-icon" aria-hidden="true">{p.icon}</span>
            <span className="model-conn__preset-label">{p.label}</span>
          </button>
        ))}
      </div>

      <div className="model-conn__hint">⚡ Setup nhanh: {activePreset.hint}</div>
      {modelCreditPolicy !== 'standard' && (
        <div className="model-conn__credit-notice" role="note">
          <strong>Chính sách credit</strong>
          <span>{MODEL_CREDIT_NOTICE_VI[modelCreditPolicy]}</span>
        </div>
      )}

      <div className="model-conn__form">
        <label className="model-conn__field">
          <span>Base URL</span>
          <input
            className="input"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder={LOCAL_COCKPIT_BASE_URL}
          />
        </label>
        <label className="model-conn__field">
          <span>Model</span>
          <input
            className="input"
            list="codexlb-model-list"
            value={model}
            onChange={(e) => setModel(e.target.value)}
            placeholder="gpt-5.6-sol"
          />
          {/* Quick-pick of codex-lb models (verified against /v1/models). Free text
              stays allowed so 9router / custom endpoints can use any model id. */}
          <datalist id="codexlb-model-list">
            <option value="izzi-smart">Izzi Smart Router</option>
            <option value="grok-4.5-high">Grok 4.5 High (Izzi canonical)</option>
            <option value="gcli/grok-4.5-high">Grok 4.5 High (9Router upstream)</option>
            <option value="gpt-5.6-sol">GPT-5.6 Sol — flagship (mạnh nhất)</option>
            <option value="gpt-5.6-terra">GPT-5.6 Terra</option>
            <option value="gpt-5.6-luna">GPT-5.6 Luna</option>
            <option value="gpt-5.5">GPT-5.5</option>
            <option value="gpt-5.4">GPT-5.4</option>
            <option value="gpt-5.4-mini">GPT-5.4 mini</option>
          </datalist>
        </label>
        <label className="model-conn__field">
          <span>
            API key{' '}
            {hasKey && <em className="model-conn__masked">(đã lưu {maskedHint})</em>}
          </span>
          <input
            className="input"
            type="password"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
            placeholder={hasKey ? 'Để trống nếu giữ key đã lưu' : 'Dán API key của endpoint'}
          />
        </label>
        <label className="model-conn__field">
          <span>Kiểu auth</span>
          <select className="input" value={authType} onChange={(e) => setAuthType(e.target.value as AuthType)}>
            <option value="bearer">Authorization: Bearer</option>
            <option value="x-api-key">x-api-key</option>
          </select>
        </label>
      </div>

      {notice && (
        <div className={`model-conn__notice ${notice.ok ? 'model-conn__notice--ok' : 'model-conn__notice--err'}`}>
          {notice.text}
        </div>
      )}

      <div className="model-conn__actions">
        <button type="button" className="btn btn--secondary" disabled={busy} onClick={() => void handleTest()}>
          Kiểm tra kết nối
        </button>
        <button type="button" className="btn btn--primary" disabled={busy} onClick={() => void handleSaveEnable()}>
          Lưu &amp; Bật
        </button>
        {enabled && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={() => void toggleEnabled()}>
            Tắt kết nối
          </button>
        )}
      </div>

      <details className="model-conn__guide">
        <summary>Hướng dẫn nhanh</summary>
        <ol>
          <li>
            <b>Cockpit local</b>: đảm bảo Cockpit API Service đang chạy ở <code>127.0.0.1:51226</code>, rồi bấm{' '}
            <b>Kết nối nhanh</b>. App sẽ dùng khóa gateway đã chiếu trên máy, không hiện khóa trong giao diện.
          </li>
          <li>
            <b>Izzi API direct</b>: chọn preset Izzi API, dán Izzi API key, rồi đổi model giữa <code>izzi-smart</code>,
            <code>grok-4.5-high</code>, hoặc <code>gpt-5.6-sol</code> tùy cách route bạn muốn.
          </li>
          <li>
            <b>9router</b>: chạy 9router/LiteLLM, lấy master key; sửa Base URL đúng cổng (mặc định 4000).
          </li>
          <li>Bấm <b>Kiểm tra kết nối</b> để xác nhận trước khi bật.</li>
          <li>
            Đã bật thì mở tab <b>Chat agent</b> và chat như thường — tin nhắn đi thẳng qua endpoint này,
            không phụ thuộc container Hermes.
          </li>
        </ol>
      </details>
    </div>
  );
}

export default ModelConnectionsPage;
