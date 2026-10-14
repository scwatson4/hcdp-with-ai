// F3 A: "Add to backlog" on the admin page copies a ready-made team-backlog entry for one feedback row — the backlog's
// own CLI command (`cli.py add --actor --id --category --title --summary`, as the team's decision imports use it), with
// the quote, the page, the ask, the reply and the wanted page in the summary. The backlog CLI lives on another VM, so
// the admin pastes it there; nothing is sent from this site.
import { EXCHANGE_FEATURES, FEATURE_LABEL, clip } from './features'

export const BACKLOG_TIP = 'Copies a ready-made team-backlog entry (title + summary). The backlog CLI lives on another VM — paste it there.'

const shq = (s) => `'${String(s ?? '').replace(/'/g, `'"'"'`)}'`

function how(row) {
  const feature = FEATURE_LABEL[row.feature] || 'the site'
  if (row.kind === 'thumbs') return `${row.rating === 'up' ? '👍' : '👎'} on ${/^[AEIOU]/i.test(feature) ? 'an' : 'a'} ${feature}`
  if (row.kind === 'selection') return 'a selected passage'
  if (row.kind === 'wrong_page') return '“Wrong page?” under an AI overview'
  return 'the Give feedback tab'
}

export function backlogEntry(row) {
  const date = String(row.created_at || '').slice(0, 10)
  const id = `FB-${date.replace(/-/g, '') || 'undated'}-${String(row.id || '').slice(0, 8)}`
  const category = EXCHANGE_FEATURES.has(row.feature) ? 'ai-behavior' : 'general-ui'
  const w = row.wanted && typeof row.wanted === 'object' ? row.wanted : null
  const headline = row.text || row.quote || (w ? `wanted ${w.title || w.url || w.text}` : how(row))
  const title = clip(`Website feedback · ${FEATURE_LABEL[row.feature] || 'Other'}: ${headline}`, 120)
  const bits = [`Review-period feedback on the HCDP website prototype (${date || 'undated'}, ${row.reviewer_name || 'anonymous'}; ${how(row)}).`]
  if (row.page_path || row.page_title) bits.push(`Page: ${row.page_title ? `${row.page_title} ` : ''}(${row.page_path || '/'}).`)
  if (row.quote) bits.push(`Quote: “${row.quote}”.`)
  if (row.text) bits.push(`Feedback: ${row.text}`)
  if (row.ask) bits.push(`Asked: “${row.ask}”.`)
  if (row.reply) bits.push(`AI reply: “${clip(row.reply, 600)}”.`)
  if (w) bits.push(`Wanted: ${w.url ? `${w.title ? `${w.title} ` : ''}(${w.url})` : `“${w.text}”`}.`)
  if (row.chose_path) bits.push(`Went to instead: ${row.chose_path}.`)
  if (row.admin_note) bits.push(`Team note: ${row.admin_note}`)
  bits.push(`Feedback id ${row.id}.`)
  const summary = bits.join(' ')
  const command = `docker exec hcdp-team-backlog python /app/cli.py add --actor ${shq('HCDP website feedback')} --id ${id} --category ${category} --title ${shq(title)} --summary ${shq(summary)}`
  return { id, category, title, summary, command }
}
