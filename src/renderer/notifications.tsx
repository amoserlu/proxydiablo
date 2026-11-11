import { useEffect, useRef, useState } from 'react';
import { Bell, BellOff, Volume2, VolumeX } from 'lucide-react';
import type { AppStateSnapshot, ProxyTab } from '../shared/types';
import { api } from './api';

const AUDIO_KEY = 'proxydiablo:audio-notifications';
const BROWSER_KEY = 'proxydiablo:browser-notifications';

function readFlag(key: string): boolean {
  try {
    return window.localStorage.getItem(key) === 'on';
  } catch {
    return false;
  }
}

function writeFlag(key: string, on: boolean): void {
  try {
    window.localStorage.setItem(key, on ? 'on' : 'off');
  } catch {
    // Preferences are a convenience; without storage they reset to off on reload.
  }
}

function browserPermission(): NotificationPermission | 'unsupported' {
  return typeof Notification === 'undefined' ? 'unsupported' : Notification.permission;
}

let audioContext: AudioContext | undefined;

/** Browsers only start audio after a user gesture, so the context is created or resumed from clicks. */
function unlockAudio(): AudioContext {
  audioContext ??= new AudioContext();
  if (audioContext.state === 'suspended') void audioContext.resume();
  return audioContext;
}

function playChime(): void {
  const context = unlockAudio();
  const start = context.currentTime;
  [880, 1320].forEach((frequency, index) => {
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    const at = start + index * 0.14;
    oscillator.type = 'sine';
    oscillator.frequency.value = frequency;
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.2, at + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.25);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.26);
  });
}

function showBrowserNotification(tab: ProxyTab | undefined): void {
  if (browserPermission() !== 'granted') return;
  const kind = tab?.proxyType === 'command' ? 'Command' : 'SQL';
  const summary = tab?.description || tab?.title || 'A request is waiting for review.';
  const notification = new Notification(`Proxy Diablo: ${kind} request waiting`, {
    body: summary.length > 140 ? `${summary.slice(0, 137)}...` : summary,
    tag: tab ? `proxydiablo-${tab.id}` : 'proxydiablo',
  });
  notification.onclick = () => {
    window.focus();
    if (tab) void api.setActiveTab(tab.id);
    notification.close();
  };
}

/** Speaker and bell toggles, both off by default, that announce each new request from an agent. */
export function NotificationToggles({ state }: { state: AppStateSnapshot }) {
  const [audio, setAudio] = useState(() => readFlag(AUDIO_KEY));
  const [browser, setBrowser] = useState(() => readFlag(BROWSER_KEY) && browserPermission() === 'granted');
  const [permission, setPermission] = useState(browserPermission);
  const initialState = useRef(state);
  const lastSeq = useRef<number | undefined>(undefined);

  useEffect(() => {
    if (!audio) return;
    // After a reload the preference is on but audio is locked until the first interaction.
    const unlock = () => unlockAudio();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, [audio]);

  useEffect(() => {
    // The first snapshot from the server is the baseline: requests already open on load are not announced.
    if (state === initialState.current) return;
    if (lastSeq.current === undefined) {
      lastSeq.current = state.attentionSeq;
      return;
    }
    if (state.attentionSeq <= lastSeq.current) return;
    lastSeq.current = state.attentionSeq;
    const tab = state.tabs.find((item) => item.id === state.attentionTabId);
    if (audio) playChime();
    if (browser) showBrowserNotification(tab);
  }, [state, audio, browser]);

  function toggleAudio() {
    const next = !audio;
    setAudio(next);
    writeFlag(AUDIO_KEY, next);
    if (next) playChime();
  }

  async function toggleBrowser() {
    if (browser) {
      setBrowser(false);
      writeFlag(BROWSER_KEY, false);
      return;
    }
    if (permission === 'unsupported') return;
    const granted = permission === 'default' ? await Notification.requestPermission() : permission;
    setPermission(granted);
    if (granted !== 'granted') return;
    setBrowser(true);
    writeFlag(BROWSER_KEY, true);
  }

  const browserTitle = permission === 'unsupported'
    ? 'This browser does not support notifications'
    : permission === 'denied'
      ? 'Notifications are blocked for this site; allow them in the browser settings'
      : browser ? 'Browser notifications on' : 'Browser notifications off';

  return (
    <div className="notification-toggles">
      <button
        className={audio ? 'on' : ''}
        aria-pressed={audio}
        title={audio ? 'Sound notifications on' : 'Sound notifications off'}
        onClick={toggleAudio}
      >{audio ? <Volume2 size={17} /> : <VolumeX size={17} />}</button>
      <button
        className={browser ? 'on' : ''}
        aria-pressed={browser}
        title={browserTitle}
        disabled={permission === 'unsupported' || permission === 'denied'}
        onClick={() => void toggleBrowser()}
      >{browser ? <Bell size={17} /> : <BellOff size={17} />}</button>
    </div>
  );
}
