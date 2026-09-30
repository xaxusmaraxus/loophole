// The on-ride photo: a flash goes off at the wildest moment of the ride and a
// camera mounted on the track catches every face. The shot becomes a polaroid
// card with the ride's stats that can be saved and shared.

export const photoStore: { url: string | null; card: string | null } = { url: null, card: null };

export interface CardInfo {
  title: string;
  sub: string;
  lines: string[];
  stamp: string;
}

function load(url: string): Promise<HTMLImageElement> {
  return new Promise((res, rej) => {
    const img = new Image();
    img.onload = () => res(img);
    img.onerror = rej;
    img.src = url;
  });
}

/** Draws the photo into a polaroid card with the ride's stats. */
export async function composeCard(url: string, o: CardInfo): Promise<string> {
  const img = await load(url);
  const W = 540;
  const H = 680;
  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const x = c.getContext('2d')!;
  x.fillStyle = '#fbf6ec';
  x.beginPath();
  x.roundRect(0, 0, W, H, 18);
  x.fill();
  const pw = W - 48;
  const ph = Math.round((pw * 3) / 4);
  x.drawImage(img, 24, 24, pw, ph);
  x.strokeStyle = 'rgba(43, 33, 64, 0.25)';
  x.lineWidth = 2;
  x.strokeRect(24, 24, pw, ph);
  let y = 24 + ph + 54;
  x.fillStyle = '#f0584e';
  x.font = '400 38px Bungee, "Arial Black", Impact, sans-serif';
  x.textBaseline = 'alphabetic';
  x.fillText(o.title, 28, y);
  y += 32;
  x.fillStyle = '#5d5578';
  x.font = '500 21px Fredoka, "Trebuchet MS", sans-serif';
  x.fillText(o.sub, 30, y);
  y += 38;
  x.fillStyle = '#2b2140';
  x.font = '600 23px Fredoka, "Trebuchet MS", sans-serif';
  for (const line of o.lines) {
    x.fillText(line, 30, y);
    y += 32;
  }
  // A rubber stamp in the photo's corner.
  x.save();
  x.translate(W - 130, 24 + ph - 44);
  x.rotate(-0.18);
  x.strokeStyle = 'rgba(240, 88, 78, 0.9)';
  x.fillStyle = 'rgba(240, 88, 78, 0.9)';
  x.lineWidth = 4;
  x.strokeRect(-92, -26, 184, 52);
  x.font = '400 22px Bungee, "Arial Black", Impact, sans-serif';
  x.textAlign = 'center';
  x.textBaseline = 'middle';
  x.fillText(o.stamp, 0, 2);
  x.restore();
  return c.toDataURL('image/png');
}

interface DownloadsNs {
  save(req: { filename: string; data: Blob }): Promise<{ status: string }>;
}

/**
 * Saves the photo card. Inside the claude.ai viewer this goes through the
 * `downloads` capability (the viewer confirms); anywhere else it's a plain
 * browser download. Returns a short note to show, or null.
 */
export async function savePhoto(): Promise<string | null> {
  const url = photoStore.card ?? photoStore.url;
  if (!url) return null;
  const filename = 'loophole-ride-photo.png';
  const blob = await (await fetch(url)).blob();
  const host = (window as unknown as { claude?: { use(name: string): Promise<unknown> } }).claude;
  if (host?.use) {
    const dl = (await host.use('downloads')) as DownloadsNs | null;
    if (!dl) return 'Saving isn’t available here.';
    try {
      await dl.save({ filename, data: blob });
      return null;
    } catch (e) {
      const code = (e as { code?: string }).code;
      return code === 'declined' ? null : 'Couldn’t save the photo.';
    }
  }
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  return null;
}
