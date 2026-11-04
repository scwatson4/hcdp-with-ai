import { describe, it, expect } from 'vitest'
import { maintenanceNotice, nightKey, BEFORE_TEXT, DURING_TEXT } from './maintenance'

// HST = UTC−10 all year: 09:00Z is 11:00 pm the evening before.
const at = (iso) => Date.parse(iso)

describe('the nightly maintenance notice', () => {
  it('is silent until 11:00 pm HST', () => {
    expect(maintenanceNotice(at('2026-11-05T08:59:00Z'))).toBeNull()      // 10:59 pm, 4 Nov
    expect(maintenanceNotice(at('2026-11-05T02:00:00Z'))).toBeNull()      // 4:00 pm
  })
  it('warns from 11:00 pm, says "until 5:00 am" from 11:30 pm, and stops at 5:00 am', () => {
    expect(maintenanceNotice(at('2026-11-05T09:00:00Z'))).toMatchObject({ phase: 'before', text: BEFORE_TEXT })
    expect(maintenanceNotice(at('2026-11-05T09:29:59Z'))).toMatchObject({ phase: 'before' })
    expect(maintenanceNotice(at('2026-11-05T09:30:00Z'))).toMatchObject({ phase: 'during', text: DURING_TEXT })
    expect(maintenanceNotice(at('2026-11-05T14:59:59Z'))).toMatchObject({ phase: 'during' })   // 4:59 am
    expect(maintenanceNotice(at('2026-11-05T15:00:00Z'))).toBeNull()                            // 5:00 am
  })
  it('names the night by the HST date it started, before and after midnight', () => {
    expect(nightKey(at('2026-11-05T09:05:00Z'))).toBe('2026-11-04')      // 11:05 pm, 4 Nov
    expect(nightKey(at('2026-11-05T13:00:00Z'))).toBe('2026-11-04')      // 3:00 am, 5 Nov
    expect(maintenanceNotice(at('2026-11-05T13:00:00Z')).night).toBe('2026-11-04')
    expect(nightKey(at('2026-11-06T09:05:00Z'))).toBe('2026-11-05')
  })
})
