/* The gloss: what a reader sees when they click something.
 *
 * Manuscripts put commentary in the margin, so that is where this lives. Pure HTML
 * generation — no selection logic, no listeners — which keeps it free of a cycle with
 * select.js (whose delegated handler reads the data-attributes these buttons carry).
 *
 * The citation block is the whole point of the project: a verbatim quote from the
 * source sits directly beside the link, so a reader can click through and find those
 * words. Never render a factual claim here without one.
 */

import { esc, fmtDate, truncate, yearOf } from './dates.js';
import {
  E, L, P, childrenOf, edgeById, eventsByActor, linksByNode, meta, undated,
} from './model.js';

function citeHTML(cits) {
  if (!cits?.length) return '';
  return cits.map((c) => `
    <div class="cite">
      ${c.quote ? `<blockquote>${esc(c.quote)}</blockquote>` : ''}
      <div class="cite-src">
        <a href="${esc(c.url)}" target="_blank" rel="noopener noreferrer">${esc(c.title || c.url)}</a>${
          c.publisher ? ` &middot; ${esc(c.publisher)}` : ''}
      </div>
    </div>`).join('');
}

const relBtn = (kind, id, label, year) =>
  `<li><button data-kind="${kind}" data-id="${esc(id)}">
     <span>${esc(label)}</span>${year ? `<span class="rel-year">${esc(String(year))}</span>` : ''}
   </button></li>`;

const section = (title, items) =>
  items.length ? `<div class="gl-sect">${title}</div><ul class="rel-list">${items.join('')}</ul>` : '';

const factList = (facts) =>
  `<dl class="gl-facts">${facts.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join('')}</dl>`;

const contested = (note) =>
  note ? `<div class="uncertain"><strong>Contested</strong> — ${esc(note)}</div>` : '';

const closeBtn = '<button class="control gl-close" data-close>close</button>';

const linkLabel = (l) => truncate(l.claim, 70);

// ── person

function personGloss(p) {
  const kids = (childrenOf.get(p.id) || []).map((c) => P.get(c)).filter(Boolean)
    .sort((a, b) => (a._b ?? 9e9) - (b._b ?? 9e9));
  const parents = (p.parents || []).map((x) => P.get(x)).filter(Boolean);
  const spouses = (p.spouses || []).map((s) => ({ s, q: P.get(s.id) })).filter((x) => x.q);
  const evs = (eventsByActor.get(p.id) || []).map((x) => E.get(x)).filter(Boolean)
    .sort((a, b) => String(a.date).localeCompare(String(b.date)));
  const ls = linksByNode.get(`person:${p.id}`) || [];

  const facts = [
    ['Born', `${fmtDate(p.birth?.date, p.birth?.precision)}${p.birth?.place ? `, ${esc(p.birth.place)}` : ''}`],
    ['Died', `${fmtDate(p.death?.date, p.death?.precision)}${p.death?.place ? `, ${esc(p.death.place)}` : ''}`],
  ];
  if (p.monarch && p.reign) {
    facts.push(['Reigned', `${fmtDate(p.reign.start)} – ${p.reign.end ? fmtDate(p.reign.end) : '?'}`]);
  }
  if (p.house) facts.push(['House', esc(p.house)]);
  if (p._claim) facts.push(['Claimed', esc(p._claim.title)]);

  return `
    ${closeBtn}
    <h2 class="gl-title">${esc(p.name)}</h2>
    <p class="gl-kicker u-caps">${
      p.monarch ? 'Monarch of England' : esc(p.role || 'Royal kin')}${
      p.epithet ? ` &middot; ${esc(p.epithet)}` : ''}</p>
    ${factList(facts)}
    <div class="gl-body"><p>${esc(p.summary)}</p></div>
    ${contested(p.uncertain)}
    ${section('Parents', parents.map((q) => relBtn('person', q.id, q.name, q._b ? Math.floor(q._b) : '')))}
    ${section('Married', spouses.map(({ s, q }) =>
      relBtn('person', q.id, q.name, s.married ? String(s.married).slice(0, 4) : '')))}
    ${section('Children', kids.map((q) => relBtn('person', q.id, q.name, q._b ? Math.floor(q._b) : '')))}
    ${section('Present at', evs.map((e) => relBtn('event', e.id, e.title, yearOf(e.date))))}
    ${section('Correlations', ls.map((l) => relBtn('link', l.id, linkLabel(l), '')))}
    <div class="gl-sect">Sources</div>
    ${citeHTML([...(p.citations || []), ...(p.birth?.citations || []),
      ...(p.death?.citations || []), ...(p.reign?.citations || [])])}
  `;
}

// ── event

function eventGloss(e) {
  const actors = (e.actors || []).map((a) => P.get(a)).filter(Boolean);
  const ls = linksByNode.get(`event:${e.id}`) || [];
  const facts = [['Date', fmtDate(e.date, e.precision) + (e.endDate ? ` – ${fmtDate(e.endDate)}` : '')]];
  if (e.place) facts.push(['Place', esc(e.place)]);
  facts.push(['Kind', esc(e.category)]);
  // `significance` is the one editorial field in the dataset, so the UI says so.
  facts.push(['Weight', `${'✦'.repeat(e.significance || 0)}
    <span class="pill editorial" style="margin-left:.4rem">editorial</span>`]);

  return `
    ${closeBtn}
    <h2 class="gl-title">${esc(e.title)}</h2>
    <p class="gl-kicker u-caps">Event &middot; ${esc(String(yearOf(e.date)))}</p>
    ${factList(facts)}
    <div class="gl-body"><p>${esc(e.summary)}</p></div>
    ${contested(e.uncertain)}
    ${section('Who was there', actors.map((p) => relBtn('person', p.id, p.name, '')))}
    ${section('Correlations', ls.map((l) => relBtn('link', l.id, linkLabel(l), '')))}
    <div class="gl-sect">Sources</div>
    ${citeHTML(e.citations)}
  `;
}

// ── correlation

function sideLabel(side) {
  if (side.kind === 'person') return P.get(side.id)?.name || side.id;
  if (side.kind === 'event') return E.get(side.id)?.title || side.id;
  const e = edgeById.get(side.id);
  if (!e) return side.id;
  return e.kind === 'pc' ? `${e.parent.name} → ${e.child.name}` : `${e.a.name} ~ ${e.b.name}`;
}

function linkGloss(l) {
  return `
    ${closeBtn}
    <h2 class="gl-title">A correlation</h2>
    <p class="gl-kicker u-caps">${esc(sideLabel(l.from))} &rarr; ${esc(sideLabel(l.to))}</p>
    <p class="claim">${esc(l.claim)}</p>
    ${factList([
      ['Relation', esc(l.relation.replace(/-/g, ' '))],
      ['Standing', `<span class="pill ${esc(l.strength)}">${esc(l.strength)}</span>`],
    ])}
    <p style="font-size:.85rem;color:var(--text-soft)">${
      l.strength === 'explicit'
        ? 'The cited source states this connection outright.'
        : 'The cited source reports this connection as a contemporary or historiographical claim, not as settled fact.'}</p>
    ${section('Endpoints', [l.from, l.to].map((s) => relBtn(s.kind, s.id, sideLabel(s), '')))}
    <div class="gl-sect">Sources for the connection</div>
    ${citeHTML(l.citations)}
  `;
}

// ── genealogical edge

function edgeGloss(id) {
  const e = edgeById.get(id);
  if (!e) return '';
  const ls = linksByNode.get(`edge:${id}`) || [];
  const corr = section('Correlations', ls.map((l) => relBtn('link', l.id, linkLabel(l), '')));

  if (e.kind === 'pc') {
    return `
      ${closeBtn}
      <h2 class="gl-title">Descent</h2>
      <p class="gl-kicker u-caps">${esc(e.parent.name)} &rarr; ${esc(e.child.name)}</p>
      <div class="gl-body"><p>${esc(e.child.name)} was born to ${esc(e.parent.name)}
        in ${esc(fmtDate(e.child.birth?.date, e.child.birth?.precision))}.</p></div>
      ${corr}
      ${section('Endpoints', [relBtn('person', e.parent.id, e.parent.name, ''),
        relBtn('person', e.child.id, e.child.name, '')])}
      <div class="gl-sect">Sources</div>
      ${citeHTML(e.child.birth?.citations?.length ? e.child.birth.citations : e.child.citations)}`;
  }

  const rec = e.rec;
  return `
    ${closeBtn}
    <h2 class="gl-title">Marriage</h2>
    <p class="gl-kicker u-caps">${esc(e.a.name)} &amp; ${esc(e.b.name)}</p>
    ${factList([
      ['Married', esc(fmtDate(rec.married, rec.precision))],
      ...(rec.ended ? [['Ended', `${esc(fmtDate(rec.ended))}${rec.endedBy ? ` (${esc(rec.endedBy)})` : ''}`]] : []),
    ])}
    ${corr}
    ${section('Endpoints', [relBtn('person', e.a.id, e.a.name, ''),
      relBtn('person', e.b.id, e.b.name, '')])}
    <div class="gl-sect">Sources</div>
    ${citeHTML(rec.citations)}`;
}

// ── empty state: explains the one idea the reader needs

const EMPTY = `
  <div class="gloss-empty">
    <h2>The Gloss</h2>
    <p style="font-size:.92rem">Genealogy and chronology share one vertical axis: <em>y is a year</em>.
    Each person is a lifespan; the gold stretch is a reign. Events sit right of the gutter.
    Because both leaves share the axis, a correlation is a short link across it.</p>
    <ul>
      <li>Click a <strong>lifespan</strong>, an <strong>event</strong>, a <strong>descent line</strong>,
          or a <strong>vermilion correlation</strong> to read it here.</li>
      <li>Every claim carries its source and a verbatim quote. Nothing here is unsourced.</li>
      <li>The chart holds the monarchs, the disputed claimants and the magnates. Select one and
          their kin fan out; <strong>kin</strong> shows all of them at once.</li>
      <li>Drag to pan; scroll or <kbd>+</kbd>/<kbd>−</kbd> to zoom the centuries.</li>
    </ul>
    <p class="u-caps" style="border-top:1px solid var(--rule-faint);padding-top:.5rem">
      ${meta.counts.people} people &middot; ${meta.counts.events} events &middot;
      ${meta.counts.links} correlations</p>
    ${undated.length ? `<p style="font-size:.8rem;color:var(--text-faint)">
      ${undated.length} ${undated.length === 1 ? 'person is' : 'people are'} absent from the chart
      for want of any sourced date: ${undated.map((p) => esc(p.name)).join(', ')}.</p>` : ''}
  </div>`;

/** @returns {string} HTML for the margin panel. */
export function glossHTML(kind, id) {
  if (!kind) return EMPTY;
  if (kind === 'person') return personGloss(P.get(id));
  if (kind === 'event') return eventGloss(E.get(id));
  if (kind === 'link') return linkGloss(L.get(id));
  if (kind === 'edge') return edgeGloss(id);
  return EMPTY;
}
