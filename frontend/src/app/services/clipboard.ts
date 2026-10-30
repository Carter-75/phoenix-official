// Copy text on Android (Capacitor Clipboard plugin) and on the web
// (navigator.clipboard, then a textarea fallback). Returns success.
import { Capacitor } from '@capacitor/core';
import { Clipboard } from '@capacitor/clipboard';

export async function copyText(text: string): Promise<boolean> {
  if (Capacitor.isNativePlatform()) {
    try { await Clipboard.write({ string: text }); return true; } catch { /* fall through */ }
  }
  try { await navigator.clipboard.writeText(text); return true; } catch { /* fall through */ }
  try {
    const ta = document.createElement('textarea');
    ta.value = text; ta.setAttribute('readonly', ''); ta.style.position = 'fixed'; ta.style.opacity = '0';
    document.body.appendChild(ta); ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  } catch { return false; }
}
