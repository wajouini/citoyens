import { NextResponse } from 'next/server';
import type { NextRequest } from 'next/server';

const PUBLIC_PATHS = ['/login', '/_next/', '/favicon'];
const BEARER_AUTH_PATHS = ['/api/pipeline/report', '/api/feeds', '/api/health'];

/**
 * Simple hash compatible with Edge Runtime (no Node crypto).
 * Must produce the same output as auth.ts's generateSessionToken.
 */
async function computeExpectedToken(password: string): Promise<string> {
  const salt = process.env.SESSION_SALT || 'citoyens-admin-default-salt';
  const data = new TextEncoder().encode(`${salt}:${password}`);
  const hashBuffer = await crypto.subtle.digest('SHA-256', data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  const hashHex = hashArray.map(b => b.toString(16).padStart(2, '0')).join('');
  return hashHex.slice(0, 48);
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl;

  if (PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(p))) {
    return addSecurityHeaders(NextResponse.next());
  }

  // Bearer token routes
  if (BEARER_AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    const apiKey = process.env.ADMIN_API_KEY;
    if (apiKey) {
      const authHeader = request.headers.get('authorization');
      const token = authHeader?.replace('Bearer ', '');
      if (token && token !== apiKey) {
        return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
      }
    }
    return addSecurityHeaders(NextResponse.next());
  }

  // If no password set, skip auth
  const adminPassword = process.env.ADMIN_PASSWORD;
  if (!adminPassword) {
    return addSecurityHeaders(NextResponse.next());
  }

  const session = request.cookies.get('admin_session');
  const expectedToken = await computeExpectedToken(adminPassword);

  if (!session?.value || session.value !== expectedToken) {
    if (pathname.startsWith('/api/')) {
      return NextResponse.json({ error: 'Unauthorized' }, { status: 401 });
    }
    return NextResponse.redirect(new URL('/login', request.url));
  }

  return addSecurityHeaders(NextResponse.next());
}

function addSecurityHeaders(response: NextResponse): NextResponse {
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('X-Frame-Options', 'DENY');
  response.headers.set('X-XSS-Protection', '1; mode=block');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  return response;
}

export const config = {
  matcher: ['/((?!_next/static|_next/image|favicon.ico).*)'],
};
