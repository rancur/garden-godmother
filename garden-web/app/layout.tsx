import type { Metadata } from 'next';
import Link from 'next/link';
import './globals.css';
import { MobileNav } from './mobile-nav';
import { ThemeToggle } from './theme-toggle';
import { DesktopNav } from './navigation';
import { MainContent } from './main-content';
import { Logo } from './logo';
import { ClientProviders } from './client-providers';
import { SearchButton } from './search-button';
import { SettingsLink } from './settings-link';
import { PwaNavigationFix } from './pwa-navigation-fix';
import { UserMenu } from './user-menu';
import { AuthNav } from './auth-layout';

export const metadata: Metadata = {
  title: 'Garden Godmother',
  description: 'Your personal garden management system',
  icons: { icon: '/favicon.svg' },
  manifest: '/manifest.json',
  appleWebApp: {
    capable: true,
    statusBarStyle: 'default',
    title: 'Garden Godmother',
  },
  other: {
    'mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-capable': 'yes',
    'apple-mobile-web-app-status-bar-style': 'default',
    'apple-mobile-web-app-title': 'Garden Godmother',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: `
          (function() {
            try {
              var theme = localStorage.getItem('garden-theme');
              if (theme === 'dark' || (!theme && window.matchMedia('(prefers-color-scheme: dark)').matches)) {
                document.documentElement.classList.add('dark');
              }
            } catch(e) {}
          })();
        `}} />
      </head>
      <body className="min-h-screen bg-earth-50 dark:bg-gray-900 text-earth-900 dark:text-gray-100">
        <PwaNavigationFix />
        <ClientProviders>
          <AuthNav>
            <nav className="bg-white dark:bg-gray-800 border-b border-earth-200 dark:border-gray-700 shadow-sm sticky top-0 z-50">
              <div className="max-w-7xl mx-auto px-3 sm:px-6 lg:px-8">
                <div className="flex items-center justify-between h-14 sm:h-16">
                  <Link href="/" className="flex items-center gap-2 shrink-0">
                    <Logo size={28} />
                    <span className="text-lg sm:text-xl font-bold text-garden-700 dark:text-garden-400">Garden Godmother</span>
                  </Link>
                  {/* Desktop nav - HubSpot-style grouped dropdowns */}
                  <div className="hidden lg:flex items-center gap-1">
                    <DesktopNav />
                    <div className="ml-2 border-l border-earth-200 dark:border-gray-700 pl-2 flex items-center gap-1">
                      <SearchButton />
                      <SettingsLink />
                      <ThemeToggle />
                      <UserMenu />
                    </div>
                  </div>
                  {/* Mobile nav */}
                  <div className="flex items-center gap-1 lg:hidden">
                    <SearchButton />
                    <ThemeToggle />
                    <UserMenu />
                    <MobileNav />
                  </div>
                </div>
              </div>
            </nav>
          </AuthNav>
          <MainContent>{children}</MainContent>
        </ClientProviders>
      </body>
    </html>
  );
}
