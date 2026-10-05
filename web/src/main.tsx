import { createRoot } from 'react-dom/client';
import './styles.css';
import { RouterProvider, match, useLocation } from './lib/router';
import { ShopProvider } from './lib/store';
import { Layout } from './components/layout';
import { CollectionPage, DeliveryPage, HomePage, NotFoundPage, PolicyPage, ShopPage } from './pages/shop';
import { MySpacePage, TrackPage } from './pages/space';
import { ItemPage } from './pages/item';
import { BagPage, OrderSentPage } from './pages/bag';
import { AdminApp, LinkPage } from './admin/admin';

function Routes() {
  const { path } = useLocation();
  const link = match('/admin/link/:token', path);
  if (link) return <LinkPage token={link.token} />;
  if (path === '/admin' || path.startsWith('/admin/')) return <AdminApp path={path} />;
  let page;
  const cat = match('/shop/:slug', path);
  const item = match('/item/:slug', path);
  const vibe = match('/vibe/:slug', path);
  const edit = match('/edit/:slug', path);
  const space = match('/my-space/:tab', path);
  const policy = match('/policy/:slug', path);
  if (path === '/') page = <HomePage />;
  else if (path === '/shop') page = <ShopPage />;
  else if (cat) page = <ShopPage category={cat.slug} />;
  else if (item) page = <ItemPage slug={item.slug} />;
  else if (path === '/bag') page = <BagPage />;
  else if (path === '/order-sent') page = <OrderSentPage />;
  else if (path === '/delivery') page = <DeliveryPage />;
  else if (vibe) page = <CollectionPage key={vibe.slug} slug={vibe.slug} kind="vibe" />;
  else if (edit) page = <CollectionPage key={edit.slug} slug={edit.slug} kind="edit" />;
  else if (policy) page = <PolicyPage slug={policy.slug} />;
  else if (path === '/track') page = <TrackPage />;
  else if (path === '/my-space') page = <MySpacePage tab="orders" />;
  else if (space) page = <MySpacePage tab={space.tab} />;
  else page = <NotFoundPage />;
  return <Layout>{page}</Layout>;
}

createRoot(document.getElementById('root')!).render(<RouterProvider><ShopProvider><Routes /></ShopProvider></RouterProvider>);
