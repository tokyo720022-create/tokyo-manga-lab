// Markup for the Tracking panel on a title (AniList). Pure string builders: app.js owns state and events.
import { escapeHtml } from '../../shared/utils.js';
import { TRACK_STATUSES, rawToScore, trackStatusLabel } from './tracking.js';

const statusOptions = current => `${current ? '' : '<option value="" selected disabled>Not on your list</option>'}${TRACK_STATUSES.map(([value, label]) => `<option value="${value}" ${current === value ? 'selected' : ''}>${label}</option>`).join('')}`;

function searchBlock(track, item, coverHtml, provider) {
  const search = track.search || {};
  const results = (search.results || []).map(media => {
    const title = media.title?.english || media.title?.romaji || media.title?.native || 'Untitled';
    const meta = [media.format ? String(media.format).replace(/_/g, ' ').toLowerCase() : '', media.startDate?.year || '', media.chapters ? `${media.chapters} chapters` : ''].filter(Boolean).join(' · ');
    return `<article class="link-candidate"><div class="link-candidate-cover">${coverHtml({ title, coverUrl: media.coverImage?.medium || null })}</div><div class="link-candidate-main"><strong>${escapeHtml(title)}</strong><small>${escapeHtml(meta || `${provider.label} title`)}</small><a class="link-candidate-open" href="${escapeHtml(provider.urlFor(media.id))}" target="_blank" rel="noopener noreferrer">Preview on ${escapeHtml(provider.label)} ↗</a></div><button class="button-primary button-small" type="button" data-action="track-link" data-media-id="${escapeHtml(media.id)}">Track this</button></article>`;
  }).join('');
  const status = search.status === 'loading' ? `<p class="muted"><span class="spinner"></span> Searching ${escapeHtml(provider.label)}…</p>`
    : search.status === 'error' ? `<div class="notice warning" role="alert">${escapeHtml(search.message || `${provider.label} search failed.`)}</div>`
    : search.status === 'done' && !results ? `<p class="muted">No ${escapeHtml(provider.label)} titles matched. Try another spelling.</p>` : '';
  return `<div class="track-find"><h4>Find this title on ${escapeHtml(provider.label)}</h4><p class="muted">Pick the right one yourself. Titles are never matched by name automatically.</p>
    <form class="link-search" data-form="track-search"><label class="sr-only" for="trackQuery">Search ${escapeHtml(provider.label)}</label><input class="field" id="trackQuery" name="q" type="search" value="${escapeHtml(search.query ?? item.title ?? '')}" maxlength="100" autocomplete="off"><button class="button-primary" type="submit">Search</button></form>
    ${status}<div class="link-candidates">${results}</div></div>`;
}

const FALLBACK_PROVIDER = Object.freeze({ key: 'anilist', label: 'AniList', mark: 'AL', url: '', choices: [] });

export function renderTrackingPanel({ track, item, coverHtml, provider = FALLBACK_PROVIDER }) {
  if (!track.open) return '';
  const info = { ...provider, urlFor: id => (provider.urlFor ? provider.urlFor(id) : `${String(provider.url || '').replace(/[^/]*$/, '')}${encodeURIComponent(id)}`) };
  const label = escapeHtml(provider.label);
  const tabs = (provider.choices || []).length > 1
    ? `<div class="track-tabs" role="tablist" aria-label="Tracker">${provider.choices.map(choice => `<button class="button button-small ${choice.key === provider.key ? 'is-active' : ''}" type="button" role="tab" aria-selected="${choice.key === provider.key}" data-action="track-provider" data-provider="${escapeHtml(choice.key)}">${escapeHtml(choice.label)}</button>`).join('')}</div>`
    : '';
  let body;
  if (track.loading) body = `<p class="muted"><span class="spinner"></span> Checking ${label}…</p>`;
  else if (!track.connected) body = `<p>Tracking saves your status, chapters read, score and dates on ${label}. It is optional.</p><p class="muted">Sign in to ${label} first. Nothing is sent until you do.</p><a class="button-primary" href="#settings/account" data-action="track-go-settings">Sign in on Profile or Settings</a>`;
  else if (!track.mediaId) body = searchBlock(track, item, coverHtml, info);
  else {
    const row = track.row || { onList: false, status: null, progress: 0, score: 0, startedAt: null, completedAt: null, totalChapters: 0, title: item.title };
    const total = Number(row.totalChapters) || 0;
    const score = rawToScore(row.score);
    const saveNote = track.note ? `<p class="track-note ${track.noteKind || ''}" role="status">${escapeHtml(track.note)}</p>` : '';
    const pending = track.pending && !track.note ? `<p class="track-note queued" role="status">Waiting to send to ${label}.</p>` : '';
    const canUnlink = item.sourceId !== provider.key;
    body = `<div class="track-card"><div class="track-head"><span class="track-logo" aria-hidden="true">${escapeHtml(provider.mark || provider.label.slice(0, 2).toUpperCase())}</span><div class="track-title"><strong>${escapeHtml(row.title || item.title)}</strong><small>${row.onList ? escapeHtml(trackStatusLabel(row.status)) : `Not on your ${provider.label} yet`}</small></div></div>
      <div class="track-grid">
        <label class="track-cell"><span>Status</span><select class="select-field" data-track-field="status" aria-label="Status on ${label}">${statusOptions(row.onList ? row.status : null)}</select></label>
        <div class="track-cell"><span>Chapters</span><div class="stepper"><button class="button button-small" type="button" data-action="track-step" data-delta="-1" aria-label="One chapter less">−</button><input class="field" data-track-field="progress" type="number" inputmode="numeric" min="0" max="100000" step="1" value="${Number(row.progress) || 0}" aria-label="Chapters read"><button class="button button-small" type="button" data-action="track-step" data-delta="1" aria-label="One chapter more">+</button></div>${total ? `<small>of ${total}</small>` : ''}</div>
        <label class="track-cell"><span>Score</span><input class="field" data-track-field="score" type="number" inputmode="decimal" min="0" max="10" step="0.5" value="${score || ''}" placeholder="0–10" aria-label="Score from 0 to 10"></label>
        <label class="track-cell"><span>Start date</span><input class="field" data-track-field="startedAt" type="date" value="${escapeHtml(row.startedAt || '')}" aria-label="Start date"></label>
        <label class="track-cell"><span>Finish date</span><input class="field" data-track-field="completedAt" type="date" value="${escapeHtml(row.completedAt || '')}" aria-label="Finish date"></label>
      </div>${saveNote}${pending}
      <div class="track-actions"><a class="button button-small" href="${escapeHtml(provider.url || info.urlFor(track.mediaId))}" target="_blank" rel="noopener noreferrer">Open on ${label} ↗</a>${canUnlink ? '<button class="button button-small" type="button" data-action="track-unlink">Track a different title</button>' : ''}</div></div>`;
  }
  return `<section class="track-panel" aria-label="Tracking"><div class="section-topline"><div><h3>Tracking</h3><p>${label} · changes are sent as soon as you make them.</p></div><button class="icon-button" type="button" data-action="track-close" aria-label="Close tracking">✕</button></div>${tabs}${body}</section>`;
}
