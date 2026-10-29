// What the Profile screen lists. `href` rows are live; planned rows come from the feature registry.
import { featuresFor } from '../feature-registry.js';

export const PROFILE_GROUPS = Object.freeze([
  {
    id: 'reading', title: 'Reading',
    rows: [
      { id: 'library', title: 'My library', description: 'Status, favourites and collections', icon: 'library', href: '#library' },
      { id: 'downloads', title: 'Downloads', description: 'Offline content and storage', icon: 'download', href: '#downloads' }
    ]
  },
  {
    id: 'settings', title: 'More',
    rows: [
      { id: 'all-settings', title: 'Settings', description: 'Appearance, reading, accounts, backup and more', icon: 'sliders', href: '#settings' }
    ]
  }
]);

export function plannedProfileRows() {
  return featuresFor('profile').map(feature => ({ ...feature, planned: true }));
}
