import { hasLocale } from 'next-intl'
import createMiddleware from 'next-intl/middleware'
import { NextResponse, type NextRequest } from 'next/server'

import { routing } from './i18n/routing'

/**
 * Next 16 renamed the `middleware` file convention to `proxy`. next-intl still exports it
 * as `createMiddleware`; only the file name changed.
 */
const handleIntl = createMiddleware(routing)

const LOCALE_COOKIE = 'NEXT_LOCALE'

const hasLocalePrefix = (pathname: string): boolean =>
  routing.locales.some((l) => pathname === `/${l}` || pathname.startsWith(`/${l}/`))

/**
 * PRD 1 §9.4's resolution order has three steps, and next-intl only gives us two of them.
 *
 * `localeDetection: false` (D17) turns off `Accept-Language` — which we want — but it also
 * turns off the **cookie**, which we do not: step 2 is "persisted preference from a previous
 * visit on this device". next-intl has no setting for one without the other, so the cookie
 * step is implemented here.
 *
 * next-intl still *writes* `NEXT_LOCALE` on every locale-prefixed request, so only the read
 * side is missing. An unprefixed path with a valid cookie is redirected to that locale;
 * everything else falls through to next-intl, which applies `en`.
 *
 * This is not a reintroduction of header sniffing. The cookie records a choice this person
 * made on this device, which is exactly the distinction D17 draws.
 */
export default function proxy(request: NextRequest): NextResponse {
  const { pathname } = request.nextUrl

  if (!hasLocalePrefix(pathname)) {
    const preferred = request.cookies.get(LOCALE_COOKIE)?.value

    if (hasLocale(routing.locales, preferred) && preferred !== routing.defaultLocale) {
      const url = request.nextUrl.clone()
      url.pathname = `/${preferred}${pathname === '/' ? '' : pathname}`
      return NextResponse.redirect(url)
    }
  }

  return handleIntl(request)
}

export const config = {
  /*
   * Everything except `/api`, Next internals and files with an extension.
   *
   * **`/api` must be excluded.** The SSE streams and every POST action live there
   * (protocol §2, §7); a locale rewrite on those would break the stream URL and serve no
   * purpose, since the wire protocol carries no translated text.
   */
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
