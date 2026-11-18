'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { parse, extractDate } = require('../server/modules/ai/nlu');
const { normalizeAr } = require('../server/lib/util');

const T = '2026-11-18';

test('تطبيع النص العربي', () => {
  assert.equal(normalizeAr('وضحى'), 'وضحي');
  assert.equal(normalizeAr('أُمّ الإبل ٢٠٢٦'), 'ام الابل 2026');
  assert.equal(normalizeAr('الشعلة؟'), 'الشعله');
});

test('استخراج التواريخ الخليجية', () => {
  assert.equal(extractDate('اليوم', T).date, T);
  assert.equal(extractDate('امس', T).date, '2026-11-17');
  assert.equal(extractDate('البارحه', T).date, '2026-11-17');
  assert.equal(extractDate('اول امس', T).date, '2026-11-16');
  assert.equal(extractDate('قبل 3 ايام', T).date, '2026-11-15');
  assert.equal(extractDate('قبل يومين', T).date, '2026-11-16');
  assert.equal(extractDate('قبل اسبوع', T).date, '2026-11-11');
  assert.equal(extractDate('2026-10-05', T).date, '2026-10-05');
  assert.equal(extractDate('5/10/2026', T).date, '2026-10-05');
  assert.equal(extractDate('31/2/2026', T).invalid, true);
});

test('أمثلة التكليف الأساسية', () => {
  assert.deepEqual(parse('لقحت وضحى اليوم من شاهين', T), { intent: 'record_mating', dam: 'وضحى', sire: 'شاهين', date: T, invalid_date: false });
  assert.deepEqual(parse('متى لقحت وضحى؟', T), { intent: 'query_last_mating', dam: 'وضحى' });
  const due = parse('أي النوق عندي بتولد الشهر القادم؟', T);
  assert.equal(due.intent, 'query_due_list');
  assert.deepEqual([due.period.from, due.period.to], ['2026-12-01', '2026-12-31']);
  assert.deepEqual(parse('وش جابت وضحى آخر مرة؟', T), { intent: 'query_last_birth', dam: 'وضحى' });
  assert.deepEqual(parse('أبي أبيع هذه الناقة', T), { intent: 'draft_listing', name: null });
});

test('معلومات ناقصة في التلقيح', () => {
  const p = parse('لقحت وضحى', T);
  assert.equal(p.intent, 'record_mating');
  assert.equal(p.sire, null);
  assert.equal(p.date, null);
});

test('تسجيل ولادة مع الجنس والاسم', () => {
  assert.deepEqual(parse('ولدت الشعلة امس بنت وسميناها غلا', T), { intent: 'record_birth', dam: 'الشعلة', calf_sex: 'female', calf_name: 'غلا', date: '2026-11-17', invalid_date: false });
  assert.equal(parse('ولدت مزنة اليوم ولد', T).calf_sex, 'male');
});

test('نوايا أخرى', () => {
  assert.equal(parse('كم عندي ناقة؟', T).intent, 'query_counts');
  assert.equal(parse('وش التنبيهات', T).intent, 'query_alerts');
  assert.equal(parse('عيال شاهين', T).intent, 'query_offspring');
  assert.equal(parse('متى تولد الشعلة', T).intent, 'query_due_one');
  assert.equal(parse('السلام عليكم', T).intent, 'greeting');
  assert.equal(parse('كيف الجو اليوم', T).intent, 'unknown');
});
