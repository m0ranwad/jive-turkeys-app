import { api } from '@/api';
import { DEFAULT_SETTINGS } from './constants';

export async function signOut() {
  await api.auth.signOut();
  window.location.href = '/login';
}

/** Saves to the single team settings row, creating it the first time. */
export async function saveTeamSettings(patch) {
  const rows = await api.entities.TeamSettings.list();
  if (rows[0]) return api.entities.TeamSettings.update(rows[0].id, patch);
  return api.entities.TeamSettings.create({ ...DEFAULT_SETTINGS, ...patch });
}
