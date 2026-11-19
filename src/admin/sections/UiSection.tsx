import { useMemo } from 'react';
import {
  Camera, ChevronDown, ChevronUp, Gamepad2, Gift, Heart, Home, MessageSquare, Music, PartyPopper, Phone, Plus, Rainbow,
  Smile, Sparkles, Star, Trash2, type LucideIcon,
} from 'lucide-react';
import type { SettingsPanelItemId, UiCustomization, WelcomeModalItem } from '@/shared/config';
import { useAdmin } from '../AdminContext';
import { ColorField, Group, NumberField, Section, Select, TextArea, TextField, Toggle, useConfirm, type Option } from '../ui';
import { LIMITS } from '../lib/validate';

/** Icon keys the app maps to icons (WelcomeModalItem.icon). Unknown keys fall back to a default in the app. */
export const WELCOME_ICONS: Record<string, LucideIcon> = {
  Phone, MessageSquare, Home, Gamepad2, Sparkles, Camera, Star, Heart, Music, Rainbow, PartyPopper, Smile, Gift,
};

const USER_ITEMS: { id: SettingsPanelItemId; label: string; hint: string }[] = [
  { id: 'trigger_keywords', label: 'Trigger words list', hint: 'Shows the words that make things happen.' },
  { id: 'experience_mode', label: 'Mode picker', hint: 'Lets visitors switch between Calm, Chat and Call debug.' },
  { id: 'call_transcripts_toggle', label: 'Show transcripts switch', hint: 'Lets visitors turn call transcripts on or off.' },
  { id: 'input_mode', label: 'Input mode picker', hint: 'Lets visitors choose live or fixed input.' },
  { id: 'user_triggers', label: 'Typed triggers switch', hint: 'Lets visitors allow their typing to trigger reactions.' },
  { id: 'call_mode_toggle', label: 'Call button switch', hint: 'Lets visitors switch between the call button and chat.' },
];
const ADMIN_ITEMS: { id: SettingsPanelItemId; label: string; hint: string }[] = [
  { id: 'admin_transcript_visibility', label: 'Transcript visibility', hint: 'Behind admin sign-in in the app.' },
  { id: 'admin_intent_engine', label: 'Intent engine', hint: 'Behind admin sign-in in the app.' },
  { id: 'admin_trigger_policy', label: 'Trigger policy', hint: 'Behind admin sign-in in the app.' },
  { id: 'admin_sms_policy', label: 'SMS policy', hint: 'Behind admin sign-in in the app.' },
  { id: 'admin_allow_user_audio_to_openai', label: 'Visitor audio to OpenAI', hint: 'Behind admin sign-in in the app.' },
  { id: 'admin_english_only', label: 'English-only transcripts', hint: 'Behind admin sign-in in the app.' },
];

const TEXTS: { key: keyof UiCustomization; label: string; hint: string }[] = [
  { key: 'experienceName', label: 'Experience name', hint: 'Used on the splash screen and when sharing.' },
  { key: 'headerTitle', label: 'Header title', hint: 'The title at the top of the chat panel.' },
  { key: 'callButtonText', label: 'Call button', hint: 'Label on the button that starts a call.' },
  { key: 'hangupButtonText', label: 'Hang up button', hint: 'Label on the button that ends a call.' },
  { key: 'chatPlaceholder', label: 'Chat box placeholder', hint: 'Grey text in the empty chat box.' },
  { key: 'commandPlaceholder', label: 'Command box placeholder', hint: 'Grey text in the box when Command mode is on.' },
  { key: 'collapsedChatText', label: 'Collapsed chat label', hint: 'Shown on the chat tab when it is folded away.' },
];

const BUTTONS: { key: keyof UiCustomization; label: string; hint: string }[] = [
  { key: 'showCallButton', label: 'Call button (computers)', hint: 'The button that starts a call on wide screens.' },
  { key: 'showMobileCallButton', label: 'Talk button (phones)', hint: 'The round talk button in the bottom right corner on phones.' },
  { key: 'showQuickActionsButton', label: 'Quick actions', hint: 'Buttons that play a reaction without saying the word.' },
  { key: 'showSettingsButton', label: 'Settings', hint: 'The settings button in the chat panel.' },
  { key: 'showKeyboardHelpButton', label: 'Keyboard help', hint: 'The keyboard shortcuts button (computers only).' },
];

function themeSwatches() {
  const css = getComputedStyle(document.documentElement);
  return ['pink', 'pink-deep', 'blue', 'yellow', 'orange', 'green', 'purple', 'red', 'ink']
    .map((n) => ({ name: n.replace('-', ' '), value: css.getPropertyValue(`--cb-${n}`).trim() }))
    .filter((s) => /^#[0-9a-f]{6}$/i.test(s.value));
}

export function UiSection() {
  const { draft, edit, errors } = useAdmin();
  const cu = draft.ui.customization;
  const p = 'ui.customization';
  const set = <K extends keyof UiCustomization>(k: K, v: UiCustomization[K]) => edit((d) => { d.ui.customization[k] = v; });
  const swatches = useMemo(themeSwatches, []);

  return (
    <Section title="Look & text" description="Words, colours and what is on screen when visitors arrive.">
      <nav className="adm-jump" aria-label="On this page">
        {[['ui-text', 'Text'], ['ui-colours', 'Colours'], ['ui-start', 'Starting layout'], ['ui-buttons', 'Buttons'],
          ['ui-welcome', 'Welcome screen'], ['ui-settings', 'Settings panel']].map(([id, t]) => (
          <a key={id} href={`#${id}`} onClick={(e) => { e.preventDefault(); document.getElementById(id)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}>{t}</a>
        ))}
      </nav>

      <div id="ui-text" />
      <Group title="Text">
        <div className="adm-grid-2">
          {TEXTS.map((t) => (
            <TextField key={t.key} path={`${p}.${t.key}`} label={t.label} hint={t.hint} value={cu[t.key] as string}
              error={errors[`${p}.${t.key}`]} onChange={(v) => set(t.key, v as never)} />
          ))}
        </div>
      </Group>

      <div id="ui-colours" />
      <Group title="Colours" description="Flat colours only. Tap a swatch to use a Happi brand colour.">
        <ColorField path={`${p}.primaryColor`} label="Main colour" value={cu.primaryColor} swatches={swatches}
          error={errors[`${p}.primaryColor`]} onChange={(v) => set('primaryColor', v)} hint="Buttons and highlights." />
        <ColorField path={`${p}.secondaryColor`} label="Second colour" value={cu.secondaryColor} swatches={swatches}
          error={errors[`${p}.secondaryColor`]} onChange={(v) => set('secondaryColor', v)} hint="Headers and secondary buttons." />
        <ColorField path={`${p}.accentColor`} label="Accent colour" value={cu.accentColor} swatches={swatches}
          error={errors[`${p}.accentColor`]} onChange={(v) => set('accentColor', v)} hint="Small touches such as badges and game progress." />
        <div className="adm-colour-preview" aria-hidden>
          <span style={{ background: cu.primaryColor }}>Main</span>
          <span style={{ background: cu.secondaryColor }}>Second</span>
          <span style={{ background: cu.accentColor, color: 'var(--cb-ink)' }}>Accent</span>
        </div>
      </Group>

      <div id="ui-start" />
      <Group title="Starting layout" description="How the screen looks before visitors touch anything.">
        <div className="adm-grid-2">
          <Toggle label="Chat open on computers" checked={cu.defaultChatExpandedDesktop} onChange={(v) => set('defaultChatExpandedDesktop', v)}
            onText="Open" offText="Closed" />
          <Toggle label="Chat open on phones" checked={cu.defaultChatExpandedMobile} onChange={(v) => set('defaultChatExpandedMobile', v)}
            onText="Open" offText="Closed" hint="Closed keeps the scene clear on small screens." />
          <Toggle label="Talk button on computers" checked={cu.defaultCallModeDesktop} onChange={(v) => set('defaultCallModeDesktop', v)} />
          <Toggle label="Talk button on phones" checked={cu.defaultCallModeMobile} onChange={(v) => set('defaultCallModeMobile', v)} />
        </div>
        <NumberField path={`${p}.uiDelayMs`} label="Wait before showing the controls" unit="ms" min={0} max={LIMITS.uiDelayMax} step={500} slider
          value={cu.uiDelayMs} error={errors[`${p}.uiDelayMs`]} onChange={(v) => set('uiDelayMs', v)}
          hint="After the scene starts, the talk button and chat wait this long so the opening moment is not covered." />
      </Group>

      <div id="ui-buttons" />
      <Group title="Buttons" description="Hide buttons you don't need at an event.">
        <div className="adm-grid-2">
          {BUTTONS.map((b) => (
            <Toggle key={b.key} label={b.label} hint={b.hint} checked={cu[b.key] as boolean} onChange={(v) => set(b.key, v as never)}
              onText="Shown" offText="Hidden" />
          ))}
        </div>
      </Group>

      <div id="ui-welcome" />
      <WelcomeEditor />

      <div id="ui-settings" />
      <SettingsItems />
    </Section>
  );
}

const iconOptions: Option<string>[] = Object.keys(WELCOME_ICONS).map((k) => ({ value: k, label: k.replace(/([a-z])([A-Z0-9])/g, '$1 $2') }));

function WelcomeEditor() {
  const { draft, edit, errors } = useAdmin();
  const confirm = useConfirm();
  const wm = draft.ui.customization.welcomeModal;
  const p = 'ui.customization.welcomeModal';
  const setWm = (recipe: (w: typeof wm) => void) => edit((d) => recipe(d.ui.customization.welcomeModal));
  const move = (i: number, by: number) => setWm((w) => {
    const j = i + by;
    if (j < 0 || j >= w.items.length) return;
    [w.items[i], w.items[j]] = [w.items[j], w.items[i]];
  });
  const removeItem = async (it: WelcomeModalItem, i: number) => {
    if (await confirm({ title: `Remove "${it.title || 'this item'}"?`, message: 'It disappears from the welcome screen when you save.', confirmText: 'Remove', danger: true })) {
      setWm((w) => { w.items.splice(i, 1); });
    }
  };
  const addItem = () => setWm((w) => {
    w.items.push({ id: `item-${Date.now().toString(36)}`, enabled: true, title: 'New item', description: '', icon: 'Sparkles' });
  });

  return (
    <Group title="Welcome screen" description="A short introduction shown once the scene is ready.">
      <div className="adm-welcome">
        <div className="adm-welcome-form">
          <Toggle label="Show the welcome screen" checked={wm.enabled} onChange={(v) => setWm((w) => { w.enabled = v; })} />
          <TextField path={`${p}.title`} label="Title" value={wm.title} error={errors[`${p}.title`]} onChange={(v) => setWm((w) => { w.title = v; })} />
          <TextArea path={`${p}.description`} label="Intro text" value={wm.description} rows={3} error={errors[`${p}.description`]}
            onChange={(v) => setWm((w) => { w.description = v; })} />
          <TextField path={`${p}.heroImageUrl`} label="Picture (optional)" type="url" placeholder="/media/welcome.jpg or https://…"
            value={wm.heroImageUrl ?? ''} error={errors[`${p}.heroImageUrl`]} onChange={(v) => setWm((w) => { w.heroImageUrl = v; })}
            hint="An image address. Files in the site's public/media folder start with /media/." />
          <Toggle label="Only once per phone" checked={wm.showOnce} onChange={(v) => setWm((w) => { w.showOnce = v; })}
            hint="After a visitor closes it, it stays closed on that device until you show it again." />
          {wm.showOnce && (
            <div className="adm-inline">
              <span className="adm-hint">Version {wm.version}.</span>
              <button type="button" className="adm-btn small" onClick={() => setWm((w) => { w.version = (w.version || 0) + 1; })}>
                Show it again to everyone
              </button>
            </div>
          )}
          {errors[`${p}.version`] && <p className="adm-error">{errors[`${p}.version`]}</p>}
          <NumberField path={`${p}.delayMs`} label="Extra wait" unit="ms" min={0} max={LIMITS.uiDelayMax} step={500}
            value={wm.delayMs} error={errors[`${p}.delayMs`]} onChange={(v) => setWm((w) => { w.delayMs = v; })}
            hint="0 shows it together with the controls. It never appears before them." />
        </div>
        <WelcomePreview />
      </div>

      <fieldset className="adm-subgroup">
        <legend>Items ({wm.items.length})</legend>
        <ol className="adm-items">
          {wm.items.map((it, i) => {
            const ip = `${p}.items.${i}`;
            return (
              <li key={it.id} className={`adm-item${it.enabled ? '' : ' is-off'}`}>
                <div className="adm-item-head">
                  <span className="adm-item-n">{i + 1}</span>
                  <Toggle compact label="Shown" checked={it.enabled} onChange={(v) => setWm((w) => { w.items[i].enabled = v; })} />
                  <div className="adm-item-tools">
                    <button type="button" className="adm-icon-btn" aria-label={`Move "${it.title}" up`} disabled={i === 0} onClick={() => move(i, -1)}><ChevronUp size={18} aria-hidden /></button>
                    <button type="button" className="adm-icon-btn" aria-label={`Move "${it.title}" down`} disabled={i === wm.items.length - 1} onClick={() => move(i, 1)}><ChevronDown size={18} aria-hidden /></button>
                    <button type="button" className="adm-icon-btn danger" aria-label={`Remove "${it.title}"`} onClick={() => removeItem(it, i)}><Trash2 size={18} aria-hidden /></button>
                  </div>
                </div>
                <div className="adm-grid-2">
                  <TextField path={`${ip}.title`} label="Title" value={it.title} error={errors[`${ip}.title`]} onChange={(v) => setWm((w) => { w.items[i].title = v; })} />
                  <Select<string> label="Icon" options={WELCOME_ICONS[it.icon] ? iconOptions : [{ value: it.icon, label: `${it.icon} (unknown)` }, ...iconOptions]}
                    value={it.icon} onChange={(v) => setWm((w) => { w.items[i].icon = v; })} />
                </div>
                <TextField path={`${ip}.description`} label="Text" value={it.description} error={errors[`${ip}.description`]}
                  onChange={(v) => setWm((w) => { w.items[i].description = v; })} />
              </li>
            );
          })}
        </ol>
        <button type="button" className="adm-btn" onClick={addItem}><Plus size={16} aria-hidden /> Add item</button>
      </fieldset>
    </Group>
  );
}

function WelcomePreview() {
  const { draft } = useAdmin();
  const cu = draft.ui.customization;
  const wm = cu.welcomeModal;
  return (
    <figure className="adm-preview" aria-label="Preview of the welcome screen">
      <figcaption className="adm-hint">Preview</figcaption>
      <div className={`adm-preview-card${wm.enabled ? '' : ' is-off'}`}>
        {wm.heroImageUrl ? <img src={wm.heroImageUrl} alt="" className="adm-preview-hero" /> : null}
        <p className="adm-preview-title">{wm.title || 'Welcome'}</p>
        <p className="adm-preview-text">{wm.description}</p>
        <ul>
          {wm.items.filter((i) => i.enabled).map((i) => {
            const Icon = WELCOME_ICONS[i.icon] ?? Sparkles;
            return (
              <li key={i.id}>
                <span className="adm-preview-icon" style={{ background: cu.primaryColor }}><Icon size={16} aria-hidden /></span>
                <span><strong>{i.title}</strong><br />{i.description}</span>
              </li>
            );
          })}
        </ul>
        <span className="adm-preview-btn" style={{ background: cu.primaryColor }}>Let's go</span>
        {!wm.enabled && <p className="adm-preview-off">Switched off</p>}
      </div>
    </figure>
  );
}

function SettingsItems() {
  const { draft, edit } = useAdmin();
  const items = draft.ui.customization.settingsPanel.items;
  const setAll = (ids: SettingsPanelItemId[], v: boolean) => edit((d) => { for (const id of ids) d.ui.customization.settingsPanel.items[id] = v; });
  const block = (title: string, desc: string, list: typeof USER_ITEMS) => {
    const all = list.every((x) => items[x.id]);
    return (
      <fieldset className="adm-subgroup">
        <legend>{title}</legend>
        <div className="adm-inline">
          <p className="adm-hint">{desc}</p>
          <button type="button" className="adm-btn small ghost" onClick={() => setAll(list.map((x) => x.id), !all)}>{all ? 'Hide all' : 'Show all'}</button>
        </div>
        <div className="adm-grid-2">
          {list.map((x) => (
            <Toggle key={x.id} label={x.label} hint={x.hint} checked={!!items[x.id]} onText="Shown" offText="Hidden"
              onChange={(v) => edit((d) => { d.ui.customization.settingsPanel.items[x.id] = v; })} />
          ))}
        </div>
      </fieldset>
    );
  };
  return (
    <Group title="In-app settings panel" description="Which options appear in the settings sheet inside the experience.">
      {block('For visitors', 'Anyone can change these.', USER_ITEMS)}
      {block('For staff', 'Need the admin password inside the app.', ADMIN_ITEMS)}
    </Group>
  );
}
