import type { NextConfig } from 'next'
import createNextIntlPlugin from 'next-intl/plugin'

const withNextIntl = createNextIntlPlugin('./i18n/request.ts')

const nextConfig: NextConfig = {
  // The workspace packages are consumed as TypeScript source rather than built
  // declarations, which keeps the monorepo free of a build step nothing else needs.
  transpilePackages: ['@kwiz/config', '@kwiz/db', '@kwiz/domain', '@kwiz/export'],

  // `better-sqlite3` is a native addon and must be required at runtime rather than
  // bundled. It is declared in slice 0 (conventions §1.1) so this belongs here now —
  // discovering it in slice 1 as an opaque bundler failure costs far more.
  serverExternalPackages: ['better-sqlite3'],
}

export default withNextIntl(nextConfig)
