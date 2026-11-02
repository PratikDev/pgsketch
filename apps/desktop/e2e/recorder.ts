import { execFileSync } from 'node:child_process';
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { expect, type Locator, type Page } from '@playwright/test';

export interface Point {
  x: number;
  y: number;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const PENCIL = readFileSync(join(process.cwd(), 'e2e/pencil.svg'), 'utf8');

// the pencil is drawn into the page, in the page's own pixels (38 x 42, its tip at 8.4 / 36.7), so
// a click and the thing it touches are in one picture; it is under no layout and takes no events
const PENCIL_SCRIPT = `(() => {
  const el = document.createElement('img');
  el.src = 'data:image/svg+xml;utf8,' + encodeURIComponent(${JSON.stringify(PENCIL)});
  Object.assign(el.style, { position: 'fixed', left: '0', top: '0', width: '38px', height: '42px', zIndex: '2147483647', pointerEvents: 'none', transform: 'translate(-200px,-200px)' });
  document.body.append(el);
  let x = -200, y = -200, dip = 0;
  const draw = () => (el.style.transform = 'translate(' + (x - 8.4) + 'px,' + (y - 36.7 + dip) + 'px)');
  addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; draw(); }, true);
  addEventListener('mousedown', () => { dip = 3; draw(); }, true);
  addEventListener('mouseup', () => { dip = 0; draw(); }, true);
})()`;

/** A pointer that moves like a hand: it arcs between things, and a click dips. */
export class Pencil {
  private at: Point = { x: 0, y: 0 };

  constructor(private readonly window: Page) {}

  /** Puts the pencil on the page, at `start`. */
  async install(start: Point): Promise<void> {
    await this.window.evaluate(PENCIL_SCRIPT);
    await this.window.mouse.move(start.x, start.y);
    this.at = start;
  }

  async centre(target: Locator): Promise<Point> {
    const box = await target.boundingBox();
    if (!box) throw new Error('nothing to point at');
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Moves along a shallow arc, easing in and out. */
  async glide(to: Point, ms = 450): Promise<void> {
    const from = this.at;
    const bow = 0.08 * Math.hypot(to.x - from.x, to.y - from.y);
    const nx = -(to.y - from.y);
    const ny = to.x - from.x;
    const norm = Math.hypot(nx, ny) || 1;
    const start = Date.now();
    for (;;) {
      const p = Math.min(1, (Date.now() - start) / ms);
      const e = p < 0.5 ? 2 * p * p : 1 - (-2 * p + 2) ** 2 / 2;
      const b = Math.sin(Math.PI * e) * bow;
      await this.window.mouse.move(
        from.x + (to.x - from.x) * e + (nx / norm) * b,
        from.y + (to.y - from.y) * e + (ny / norm) * b,
      );
      if (p === 1) break;
      await sleep(8);
    }
    this.at = to;
  }

  async click(): Promise<void> {
    await this.window.mouse.down();
    await sleep(70);
    await this.window.mouse.up();
  }

  /** Glides to the middle of something and clicks it. */
  async tap(target: Locator, ms = 450): Promise<void> {
    await this.glide(await this.centre(target), ms);
    await this.click();
  }

  async type(text: string, every = 80): Promise<void> {
    // the first keys of a new input are lost if they come before it has the focus
    await expect
      .poll(() =>
        this.window.evaluate<string>(
          "document.activeElement ? document.activeElement.tagName : ''",
        ),
      )
      .toBe('INPUT');
    for (const char of text) {
      await this.window.keyboard.type(char);
      await sleep(every);
    }
  }

  /** Holds a button down on the edge of one row and lets go on the edge of another: a foreign key. */
  async drag(from: Locator, to: Locator, ms = 700): Promise<void> {
    const a = await from.boundingBox();
    const b = await to.boundingBox();
    if (!a || !b) throw new Error('nothing to drag between');
    await this.glide({ x: a.x, y: a.y + a.height / 2 }, 450);
    await this.window.mouse.down();
    await this.glide({ x: b.x, y: b.y + b.height / 2 }, ms);
    await this.window.mouse.up();
  }

  async rest(ms: number): Promise<void> {
    await sleep(ms);
  }
}

interface Frame {
  file: string;
  at: number;
}

/**
 * Records what `run` does to the page as an animated GIF. Chromium's screencast sends a frame
 * when the page changes, so a still stretch is one frame; the frames are laid out in time and
 * then resampled, with one palette for the whole picture. Needs `ffmpeg` on the path.
 */
export async function recordGif(
  window: Page,
  out: string,
  run: (pencil: Pencil) => Promise<void>,
  options: { start: Point; fps?: number } = { start: { x: 40, y: 40 } },
): Promise<void> {
  const folder = mkdtempSync(join(tmpdir(), 'pgsketch-gif-'));
  const frames: Frame[] = [];
  const cdp = await window.context().newCDPSession(window);
  cdp.on('Page.screencastFrame', (frame) => {
    const file = join(folder, `${String(frames.length).padStart(5, '0')}.jpg`);
    writeFileSync(file, Buffer.from(frame.data, 'base64'));
    frames.push({ file, at: frame.metadata.timestamp ?? 0 });
    // a frame that arrives as the window closes has nobody left to answer it
    cdp
      .send('Page.screencastFrameAck', { sessionId: frame.sessionId })
      .catch(() => undefined);
  });
  const pencil = new Pencil(window);
  await pencil.install(options.start);
  await cdp.send('Page.startScreencast', { format: 'jpeg', quality: 95 });
  await sleep(300);
  await run(pencil);
  await sleep(700);
  await cdp.send('Page.stopScreencast');
  await sleep(150);
  await cdp.detach();
  if (frames.length === 0) throw new Error('nothing was recorded');

  const end = (frames[frames.length - 1]?.at ?? 0) + 0.4;
  const list = frames
    .map((frame, i) => {
      const next = frames[i + 1]?.at ?? end;
      return `file '${frame.file}'\nduration ${Math.max(0.001, next - frame.at).toFixed(4)}`;
    })
    .join('\n');
  const concat = join(folder, 'frames.ffconcat');
  writeFileSync(
    concat,
    `ffconcat version 1.0\n${list}\nfile '${frames[frames.length - 1]?.file}'\n`,
  );
  mkdirSync(dirname(out), { recursive: true });
  const fps = options.fps ?? 12;
  execFileSync(
    'ffmpeg',
    [
      ...['-v', 'error', '-y', '-f', 'concat', '-safe', '0', '-i', concat],
      ...[
        '-vf',
        `fps=${fps},split[a][b];[a]palettegen=max_colors=96:stats_mode=diff[p];[b][p]paletteuse=dither=none:diff_mode=rectangle`,
      ],
      ...['-loop', '0', out],
    ],
    { stdio: 'inherit' },
  );
  rmSync(folder, { recursive: true, force: true });
}
