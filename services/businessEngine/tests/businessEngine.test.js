const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadEngine() {
  const root = path.resolve(__dirname, '..');
  const context = { console };
  context.globalThis = context;
  vm.createContext(context);
  vm.runInContext(fs.readFileSync(path.join(root, 'registry.js'), 'utf8'), context);
  vm.runInContext(fs.readFileSync(path.join(root, 'businessEngine.js'), 'utf8'), context);
  return context.OmniBusinessEngine;
}

const engine = loadEngine();
const requiredTypes = [
  'computer_shop', 'auto_parts', 'mobile_shop', 'electronics',
  'restaurant', 'supermarket', 'pharmacy', 'fashion',
  'grocery', 'hardware', 'book_store', 'general_store'
];
const entities = ['product', 'customer', 'supplier', 'invoice', 'purchase', 'sale'];

test('registry contains every required business type and entity', () => {
  const available = engine.listBusinessTypes();
  requiredTypes.forEach(type => {
    assert.ok(available.includes(type), `${type} missing`);
    entities.forEach(entity => assert.ok(Array.isArray(engine.getFields(entity, type))));
  });
});

test('all declared controls use a supported field type', () => {
  requiredTypes.forEach(type => {
    entities.forEach(entity => {
      engine.getFields(entity, type).forEach(field => {
        assert.ok(engine.supportedTypes.includes(field.type), `${type}.${entity}.${field.key}`);
      });
    });
  });
});

test('auto parts validation requires OEM, vehicle brand and compatible models', () => {
  const invalid = engine.validate('product', { customFields: {} }, 'auto_parts');
  assert.equal(invalid.valid, false);
  assert.deepEqual(
    Array.from(invalid.errors, error => error.key).sort(),
    ['compatible_models', 'oem_number', 'vehicle_brand'].sort()
  );
  const valid = engine.validate('product', {
    customFields: { oem_number: 'OEM-1', vehicle_brand: 'Toyota', compatible_models: 'Corolla' }
  }, 'auto_parts');
  assert.equal(valid.valid, true);
});

test('restaurant requires kitchen while calories remain optional', () => {
  assert.equal(engine.validate('product', { customFields: {} }, 'restaurant').valid, false);
  assert.equal(engine.validate('product', { customFields: { kitchen: 'main' } }, 'restaurant').valid, true);
});

test('renderer supports all requested controls', () => {
  const schema = {
    id: 'test_business',
    entities: {
      product: [
        { key: 'a', label: 'A', type: 'text' },
        { key: 'b', label: 'B', type: 'number' },
        { key: 'c', label: 'C', type: 'select', options: ['x'] },
        { key: 'd', label: 'D', type: 'checkbox' },
        { key: 'e', label: 'E', type: 'textarea' },
        { key: 'f', label: 'F', type: 'date' },
        { key: 'g', label: 'G', type: 'serial' },
        { key: 'h', label: 'H', type: 'barcode' },
        { key: 'i', label: 'I', type: 'currency' }
      ],
      customer: [], supplier: [], invoice: [], purchase: [], sale: []
    },
    masterData: { categories: [], brands: [], units: [], tags: [] }
  };
  engine.registerSchema('test_business', schema);
  const html = engine.renderFields('product', 'test_business');
  ['text', 'number', 'select', 'checkbox', 'textarea', 'date', 'serial', 'barcode', 'currency']
    .forEach(type => assert.match(html, new RegExp(`data-schema-type="${type}"`)));
});

test('dynamic table columns differ by business type', () => {
  const autoHeaders = engine.renderTableHeaders('auto_parts');
  const restaurantHeaders = engine.renderTableHeaders('restaurant');
  assert.match(autoHeaders, /OEM Number/);
  assert.match(restaurantHeaders, /Kitchen/);
  assert.notEqual(autoHeaders, restaurantHeaders);
});

test('master data returns isolated copies', () => {
  const first = engine.getMasterData('computer_shop');
  first.categories.push('MUTATION');
  const second = engine.getMasterData('computer_shop');
  assert.equal(second.categories.includes('MUTATION'), false);
});

test('unknown business type safely falls back to computer_shop', () => {
  assert.equal(engine.normalizeType('unknown_type'), 'computer_shop');
  assert.equal(engine.getSchema('unknown_type').id, 'computer_shop');
});
