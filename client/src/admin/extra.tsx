import type { AdminPage } from './Admin';
import { Proofs } from './Proofs';
import { Topics } from './Topics';
import { Orders } from './Orders';

/** Pages added by later steps (referral proofs, topics; orders and journal stats follow). */
export const EXTRA_PAGES: AdminPage[] = [
  { path: 'proofs', title: 'Social posts', min: 'support', element: () => <Proofs /> },
  { path: 'topics', title: 'Topics', min: 'editor', element: () => <Topics /> },
  { path: 'orders', title: 'Orders', min: 'viewer', element: () => <Orders /> },
];
