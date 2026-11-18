'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { ageName } = require('../server/lib/ageNames');
const T = '2026-11-18';

test('أسماء الإبل حسب العمر (حسب جدول صاحب المشروع)', () => {
  const cases = [
    ['2026-06-01', 'male', 'حوار'], ['2026-06-01', 'female', 'حوار'],
    ['2025-11-18', 'male', 'مفرود'], ['2025-11-19', 'male', 'حوار'],
    ['2025-01-01', 'female', 'مفرودة'],
    ['2024-11-18', 'male', 'حق'], ['2024-11-18', 'female', 'حقة'],
    ['2023-11-01', 'female', 'لقية'], ['2022-11-01', 'male', 'جذع'],
    ['2021-11-01', 'female', 'ثنية'], ['2020-11-01', 'male', 'رباع'],
    ['2019-11-01', 'female', 'سديسة'], ['2010-01-01', 'male', 'بعير'], ['2010-01-01', 'female', 'فاطر'],
  ];
  for (const [bd, sex, want] of cases) assert.equal(ageName(bd, sex, T).name, want, `${bd} ${sex}`);
  assert.equal(ageName(null, 'male', T), null);
});
