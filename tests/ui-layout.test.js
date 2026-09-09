import { test } from 'node:test'
import assert from 'node:assert/strict'
import { placePopover } from '../src/utils/ui-layout.js'

test('floating menus fit viewport edges and open above a bottom toolbar', () => {
  const result = placePopover({ top: 680, bottom: 720, right: 1400 }, { width: 264, height: 156 }, { width: 1440, height: 740 })
  assert.equal(result.top, 516)
  assert.equal(result.left, 1136)
  assert.ok(result.top + 156 < 680)
  const narrow = placePopover({ top: 30, bottom: 70, right: 35 }, { width: 264, height: 400 }, { width: 240, height: 300 })
  assert.equal(narrow.left, 8)
  assert.equal(narrow.width, 224)
  assert.ok(narrow.top + narrow.maxHeight <= 292)
})
