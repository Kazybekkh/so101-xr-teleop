import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export const runtime = 'nodejs';

/**
 * Saves a paired demo recording: the webcam video (WebM) and the
 * synchronized XR input stream (JSON) into a single named folder under
 * <repo>/recordings/<name>/.
 *
 * Expects multipart/form-data with fields:
 *   video: File (webm)
 *   input: File or string (json)
 *   name:  string (folder name)
 */
export async function POST(req: NextRequest) {
  try {
    const form = await req.formData();
    const video = form.get('video') as File | null;
    const inputJson = form.get('input');
    const name = (form.get('name') as string | null) ?? `session-${Date.now()}`;

    const safeName = name.replace(/[^a-zA-Z0-9_-]/g, '_');
    const dir = join(process.cwd(), 'recordings', safeName);
    await mkdir(dir, { recursive: true });

    if (video) {
      const bytes = Buffer.from(await video.arrayBuffer());
      await writeFile(join(dir, 'video.webm'), bytes);
    }

    if (inputJson) {
      const text =
        typeof inputJson === 'string'
          ? inputJson
          : await (inputJson as File).text();
      await writeFile(join(dir, 'input.json'), text);
    }

    const meta = {
      name: safeName,
      savedAt: new Date().toISOString(),
      hasVideo: !!video,
      hasInput: !!inputJson,
    };
    await writeFile(join(dir, 'meta.json'), JSON.stringify(meta, null, 2));

    console.log(`[recording] Session saved → ${dir}`);
    return NextResponse.json({ ok: true, path: dir, meta });
  } catch (e) {
    console.error('[recording] save-session error:', e);
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
