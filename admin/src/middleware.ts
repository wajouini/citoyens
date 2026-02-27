import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/_next/', '/favicon'];
const BEARER_AUTH_PATHS = ['/api/pipeline/report', '/api/feeds', '/api/health'];

export function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (
    PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))
  ) {
    return NextResponse.next();
  }

  // Routes that authenticate via Bearer token — skip session check
  if (BEARER_AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next();
  }

  // If ADMIN_PASSWORD is not set, skip auth
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return NextResponse.next();
  }

  // Check session cookie
  const session = request.cookies.get('admin_session');

  // Compute expected token (same logic as auth.ts)
  let hash = 0;
  const str = `citoyens-admin-${adminPassword}`;
  for (let i = 0; i < str.length; i++) {
    const char = str.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash |= 0;
  }
  const expectedToken = `s_${Math.abs(hash).toString(36)}`;

  if (session?.value !== expectedToken) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
