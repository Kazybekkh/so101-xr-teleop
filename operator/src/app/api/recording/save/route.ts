import { NextRequest, NextResponse } from 'next/server';
import { writeFile, mkdir } from 'fs/promises';
import { join } from 'path';

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const { frames, filename } = body as {
      frames: unknown[];
      filename: string;
    };

    if (!Array.isArray(frames) || frames.length === 0) {
      return NextResponse.json(
        { error: 'No frames provided' },
        { status: 400 },
      );
    }

    const dir = join(process.cwd(), 'recordings');
    await mkdir(dir, { recursive: true });

    const safeName = (filename || `xr-recording-${Date.now()}`).replace(
      /[^a-zA-Z0-9_-]/g,
      '_',
    );
    const filePath = join(dir, `${safeName}.json`);

    await writeFile(filePath, JSON.stringify(frames, null, 2));

    console.log(
      `[recording] Saved ${frames.length} frames → ${filePath}`,
    );

    return NextResponse.json({ ok: true, path: filePath, count: frames.length });
  } catch (e) {
    console.error('[recording] Save error:', e);
    return NextResponse.json(
      { error: String(e) },
      { status: 500 },
    );
  }
}
