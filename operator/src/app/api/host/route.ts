import { NextRequest, NextResponse } from 'next/server';
import { networkInterfaces } from 'os';

export const runtime = 'nodejs';

/**
 * Returns the best-guess LAN URL of the dev server so the publisher page
 * can build QR codes that point to a host reachable by the Zapbox
 * (rather than localhost, which a phone can't resolve).
 */
export async function GET(req: NextRequest) {
  const reqUrl = new URL(req.url);
  const protocol = reqUrl.protocol.replace(':', '');
  const port = reqUrl.port || (protocol === 'https' ? '443' : '80');

  const ifaces = networkInterfaces();
  let lanIp: string | null = null;

  for (const name of Object.keys(ifaces)) {
    for (const info of ifaces[name] ?? []) {
      if (info.family !== 'IPv4' || info.internal) continue;
      if (info.address.startsWith('169.254.')) continue; // link-local
      // Prefer common private-LAN ranges
      if (
        info.address.startsWith('192.168.') ||
        info.address.startsWith('10.') ||
        info.address.startsWith('172.')
      ) {
        lanIp = info.address;
        break;
      }
    }
    if (lanIp) break;
  }

  const lanUrl = lanIp
    ? `${protocol}://${lanIp}:${port}`
    : `${protocol}://${reqUrl.hostname}:${port}`;

  return NextResponse.json({ lanUrl, lanIp, port, protocol });
}
