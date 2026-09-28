import './styles.css';
import { Suspense, lazy, type ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import { AppProvider, useApp } from './lib/app-state';
import { RouterProvider, match, useLocation } from './lib/router';
import { Loading } from './components/ui';
import { AirtimePage, DataBundlesPage, HomePage, RatesPage } from './pages/shop';
import { CheckoutPage, OrderPage } from './pages/checkout';
import { ForgotPage, InviteAcceptPage, LoginPage, RegisterPage, ResetPage } from './pages/auth';
import { AccountAgent, AccountHome, AccountOrders, AccountProfile, AccountRecipients, AccountTickets, GuestOrdersPage } from './pages/account';
import { TrackPage, NotificationsPage } from './pages/track';
import { AboutPage, ContactPage, HowItWorksPage, NotFoundPage, PrivacyPage, RefundPolicyPage, SupportPage, TermsPage, TicketPage } from './pages/content';

const AdminApp = lazy(() => import('./admin/AdminApp'));

type R = [string, (p: Record<string, string>) => ReactNode];
const routes: R[] = [
  ['/', () => <HomePage />],
  ['/airtime', () => <AirtimePage />],
  ['/data-bundles', () => <DataBundlesPage />],
  ['/rates', () => <RatesPage />],
  ['/how-it-works', () => <HowItWorksPage />],
  ['/track', () => <TrackPage />],
  ['/notifications', () => <NotificationsPage />],
  ['/support', () => <SupportPage />],
  ['/about', () => <AboutPage />],
  ['/contact', () => <ContactPage />],
  ['/terms', () => <TermsPage />],
  ['/privacy', () => <PrivacyPage />],
  ['/refund-policy', () => <RefundPolicyPage />],
  ['/login', () => <LoginPage />],
  ['/register', () => <RegisterPage />],
  ['/forgot-password', () => <ForgotPage />],
  ['/reset-password', () => <ResetPage />],
  ['/checkout', () => <CheckoutPage />],
  ['/order/:ref', (p) => <OrderPage key={p.ref} reference={p.ref.toUpperCase()} />],
  ['/ticket/:ref', (p) => <TicketPage reference={p.ref.toUpperCase()} />],
  ['/account', () => <AccountHome />],
  ['/account/orders', () => <AccountOrdersOrGuest />],
  ['/account/recipients', () => <AccountRecipients />],
  ['/account/tickets', () => <AccountTickets />],
  ['/account/profile', () => <AccountProfile />],
  ['/account/agent', () => <AccountAgent />],
  ['/admin/invite/:token', (p) => <InviteAcceptPage token={p.token} />],
];

function AccountOrdersOrGuest() {
  const { user, userLoaded } = useApp();
  if (!userLoaded) return <Loading />;
  return user ? <AccountOrders /> : <GuestOrdersPage />;
}

function App() {
  const { path } = useLocation();
  if (path === '/admin' || (path.startsWith('/admin/') && !path.startsWith('/admin/invite/'))) {
    return <Suspense fallback={<Loading text="Opening dashboard…" />}><AdminApp /></Suspense>;
  }
  for (const [pattern, render] of routes) {
    const m = match(pattern, path);
    if (m) return <>{render(m)}</>;
  }
  return <NotFoundPage />;
}

createRoot(document.getElementById('root')!).render(
  <RouterProvider><AppProvider><App /></AppProvider></RouterProvider>,
);

if ('serviceWorker' in navigator && location.protocol === 'https:') {
  window.addEventListener('load', () => { navigator.serviceWorker.register('/sw.js').catch(() => {}); });
}
