import { NextRequest, NextResponse } from 'next/server';
import { publish } from 'eloport/lib/input-broker';
import type { InputPacket } from 'eloport/lib/types';

export async function POST(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const session = searchParams.get('session');
    if (!session) {
      return NextResponse.json({ error: 'missing session' }, { status: 400 });
    }
    const packet = (await req.json()) as InputPacket;
    publish(session, packet);
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: String(e) }, { status: 500 });
  }
}
