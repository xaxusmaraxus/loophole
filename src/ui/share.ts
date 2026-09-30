import { photoStore } from './photo';

// Sharing a ride report: the system share sheet with the photo card attached
// where the browser allows it, else links to the big networks and a copy button.

export const SHARE_URL = 'https://claude.ai/artifact/4rGPoEjpKaMQVwXhZYPNpW';

export interface ShareInfo {
  text: string;
}

export let shareInfo: ShareInfo = { text: '' };

export function setShareText(text: string): void {
  shareInfo = { text };
}

const enc = encodeURIComponent;

export function shareLinks(): { id: string; label: string; href: string }[] {
  const t = shareInfo.text;
  const u = SHARE_URL;
  return [
    { id: 'x', label: 'X', href: `https://x.com/intent/post?text=${enc(t)}&url=${enc(u)}` },
    { id: 'facebook', label: 'Facebook', href: `https://www.facebook.com/sharer/sharer.php?u=${enc(u)}&quote=${enc(t)}` },
    { id: 'whatsapp', label: 'WhatsApp', href: `https://wa.me/?text=${enc(`${t} ${u}`)}` },
    { id: 'reddit', label: 'Reddit', href: `https://www.reddit.com/submit?url=${enc(u)}&title=${enc(t)}` },
    { id: 'bluesky', label: 'Bluesky', href: `https://bsky.app/intent/compose?text=${enc(`${t} ${u}`)}` },
  ];
}

/** The system share sheet, with the photo card if the browser takes files. Returns a note, or null. */
export async function shareNative(): Promise<string | null> {
  const nav = navigator as Navigator & { canShare?: (d: ShareData) => boolean };
  if (!nav.share) return 'No share sheet here: use the buttons.';
  const data: ShareData = { title: 'Loophole', text: shareInfo.text, url: SHARE_URL };
  const url = photoStore.card ?? photoStore.url;
  if (url) {
    try {
      const blob = await (await fetch(url)).blob();
      const file = new File([blob], blob.type === 'image/jpeg' ? 'loophole-ride.jpg' : 'loophole-ride.png', { type: blob.type });
      if (nav.canShare?.({ files: [file] })) data.files = [file];
    } catch {
      /* share without the picture */
    }
  }
  try {
    await nav.share(data);
    return null;
  } catch (e) {
    return (e as DOMException).name === 'AbortError' ? null : 'Sharing is blocked here: use the buttons.';
  }
}

export async function copyShare(): Promise<boolean> {
  const s = `${shareInfo.text} ${SHARE_URL}`;
  try {
    await navigator.clipboard.writeText(s);
    return true;
  } catch {
    const ta = document.createElement('textarea');
    ta.value = s;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.append(ta);
    ta.select();
    const ok = document.execCommand('copy');
    ta.remove();
    return ok;
  }
}
