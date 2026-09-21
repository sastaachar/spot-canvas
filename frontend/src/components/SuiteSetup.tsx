import { missingRequiredSettings, type SuiteSettingField, type SuiteSettings, type SuiteSettingValue } from '@spot-canvas/sdk';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { getSuite } from '../core/registry';
import { useCanvasStore } from '../core/store';
import { useSetupStore } from '../core/suites';
import { currentTheme } from '../core/theme';
import { useToastStore } from '../core/toasts';
import pluginBaseCss from '../styles/plugin-base.css?inline';

const SYSTEM = 'spot-canvas';

function coerce(field: SuiteSettingField, raw: string | boolean): SuiteSettingValue | undefined {
  if (field.type === 'boolean') return raw === true || raw === 'true';
  if (typeof raw !== 'string') return undefined;
  const value = raw.trim();
  if (value === '') return undefined;
  if (field.type === 'number') {
    const n = Number(value);
    return Number.isFinite(n) ? n : undefined;
  }
  return value;
}

export function SuiteSetup() {
  const suiteId = useSetupStore((s) => s.suiteId);
  const onDone = useSetupStore((s) => s.onDone);
  const close = useSetupStore((s) => s.close);
  const state = useCanvasStore((s) => (suiteId ? s.suites[suiteId] : undefined));
  const suite = suiteId ? getSuite(suiteId) : undefined;

  useEffect(() => {
    if (!suiteId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [suiteId, close]);

  if (!suiteId || !suite) return null;

  const finish = (settings: SuiteSettings): boolean => {
    const merged = { ...state?.settings, ...settings };
    const missing = missingRequiredSettings(suite.manifest, merged);
    if (missing.length > 0) {
      useToastStore.getState().push(`${suite.manifest.name} still needs: ${missing.map((f) => f.label).join(', ')}`, 'error', SYSTEM);
      return false;
    }
    useCanvasStore.getState().configureSuite(suite.manifest.id, settings);
    close();
    onDone?.();
    return true;
  };

  return (
    <div className="modal" role="presentation" onPointerDown={(e) => e.target === e.currentTarget && close()}>
      <div className="modal__card" role="dialog" aria-modal="true" aria-label={`Set up ${suite.manifest.name}`}>
        <header className="modal__head">
          <div>
            <h2>{suite.manifest.name}</h2>
            {suite.manifest.description && <p>{suite.manifest.description}</p>}
          </div>
          <button type="button" aria-label="Close" onClick={close}>
            ✕
          </button>
        </header>
        {suite.setup ? (
          <CustomSetup key={suite.manifest.id} setup={suite.setup} settings={state?.settings ?? {}} finish={finish} cancel={close} />
        ) : (
          <SettingsForm key={suite.manifest.id} fields={suite.manifest.settings} settings={state?.settings ?? {}} finish={finish} cancel={close} />
        )}
      </div>
    </div>
  );
}

interface FormProps {
  fields: SuiteSettingField[];
  settings: SuiteSettings;
  finish(settings: SuiteSettings): boolean;
  cancel(): void;
}

function SettingsForm({ fields, settings, finish, cancel }: FormProps) {
  const [values, setValues] = useState<Record<string, string | boolean>>(() =>
    Object.fromEntries(fields.map((f) => [f.key, f.type === 'boolean' ? settings[f.key] === true : String(settings[f.key] ?? '')]))
  );

  const submit = (e: FormEvent) => {
    e.preventDefault();
    const out: SuiteSettings = {};
    for (const field of fields) {
      const value = coerce(field, values[field.key] ?? '');
      if (value !== undefined) out[field.key] = value;
    }
    finish(out);
  };

  return (
    <form className="setup" onSubmit={submit}>
      {fields.map((field) => {
        const id = `setup-${field.key}`;
        const value = values[field.key];
        return (
          <div key={field.key} className={`setup__field${field.type === 'boolean' ? ' is-inline' : ''}`}>
            <label htmlFor={id}>
              {field.label}
              {field.required && <span aria-hidden="true"> *</span>}
            </label>
            {field.type === 'select' ? (
              <select id={id} value={String(value ?? '')} required={field.required} onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}>
                <option value="">Choose…</option>
                {field.options?.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            ) : field.type === 'boolean' ? (
              <input id={id} type="checkbox" checked={value === true} onChange={(e) => setValues({ ...values, [field.key]: e.target.checked })} />
            ) : (
              <input
                id={id}
                type={field.type === 'secret' ? 'password' : field.type === 'number' ? 'number' : field.type === 'url' ? 'url' : 'text'}
                value={String(value ?? '')}
                placeholder={field.placeholder}
                required={field.required}
                autoComplete="off"
                onChange={(e) => setValues({ ...values, [field.key]: e.target.value })}
              />
            )}
            {field.help && <small>{field.help}</small>}
          </div>
        );
      })}
      <div className="setup__actions">
        <button type="button" className="tb-btn" onClick={cancel}>
          Cancel
        </button>
        <button type="submit" className="tb-btn tb-btn--primary">
          Save
        </button>
      </div>
    </form>
  );
}

interface CustomProps {
  setup: NonNullable<ReturnType<typeof getSuite>>['setup'] & {};
  settings: SuiteSettings;
  finish(settings: SuiteSettings): boolean;
  cancel(): void;
}

function CustomSetup({ setup, settings, finish, cancel }: CustomProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = hostRef.current;
    if (!el) return;
    const root = el.shadowRoot ?? el.attachShadow({ mode: 'open' });
    root.replaceChildren();
    const base = document.createElement('style');
    base.textContent = pluginBaseCss;
    root.append(base);
    const host = document.createElement('div');
    host.className = 'plugin-host';
    root.append(host);
    let unmount: (() => void) | void;
    try {
      unmount = setup(host, {
        settings: { get: () => Object.freeze({ ...settings }) },
        complete: (next) => void finish(next),
        cancel,
        ui: { notify: (message, kind = 'info') => useToastStore.getState().push(message, kind, SYSTEM) },
        theme: { get: currentTheme }
      });
    } catch (error) {
      console.warn('[spot-canvas] suite setup failed to mount', error);
      useToastStore.getState().push('This suite’s setup step failed to start.', 'error', SYSTEM);
    }
    return () => {
      if (typeof unmount === 'function') {
        try {
          unmount();
        } catch {
          // the dialog is closing regardless
        }
      }
      root.replaceChildren();
    };
  }, [setup, settings, finish, cancel]);

  return <div className="setup__custom" ref={hostRef} />;
}
