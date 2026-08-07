(function (root) {
  'use strict';

  const field = (key, label, type = 'text', extra = {}) => ({ key, label, type, ...extra });
  const common = {
    customer: [
      field('customer_type', 'نوع العميل', 'select', { options: ['individual', 'company'] }),
      field('tax_number', 'الرقم الضريبي'),
      field('address', 'العنوان', 'textarea')
    ],
    supplier: [
      field('supplier_code', 'كود المورد'),
      field('tax_number', 'الرقم الضريبي'),
      field('payment_terms', 'شروط الدفع', 'textarea')
    ],
    invoice: [
      field('reference', 'مرجع خارجي'),
      field('due_date', 'تاريخ الاستحقاق', 'date'),
      field('tax_included', 'السعر شامل الضريبة', 'checkbox')
    ],
    purchase: [
      field('supplier_reference', 'مرجع المورد'),
      field('expected_date', 'تاريخ التوريد المتوقع', 'date')
    ],
    sale: [
      field('sales_channel', 'قناة البيع', 'select', { options: ['store', 'online', 'phone', 'other'] }),
      field('delivery_required', 'يتطلب توصيل', 'checkbox')
    ]
  };

  const definitions = {
    computer_shop: {
      product: [
        field('barcode', 'Barcode', 'barcode', { storage: 'direct' }),
        field('brand', 'الماركة', 'text', { table: true, storage: 'direct' }),
        field('model', 'الموديل', 'text', { table: true, storage: 'direct' }),
        field('color', 'اللون', 'text', { storage: 'direct' }),
        field('storage_location', 'مكان التخزين'),
        field('cpu', 'CPU'),
        field('ram', 'RAM'),
        field('ssd', 'SSD'),
        field('gpu', 'GPU')
      ],
      masterData: {
        categories: ['Laptops', 'Desktop', 'Components', 'Monitors', 'Accessories'],
        brands: ['Dell', 'HP', 'Lenovo', 'ASUS', 'Acer'],
        units: ['قطعة', 'جهاز', 'كرتونة'],
        tags: ['Gaming', 'Business', 'New', 'Used']
      }
    },
    auto_parts: {
      product: [
        field('barcode', 'Barcode', 'barcode', { storage: 'direct' }),
        field('part_number', 'Part Number', 'text', { table: true, storage: 'direct', legacyKey: 'partNumber' }),
        field('oem_number', 'OEM Number', 'text', { required: true, table: true }),
        field('vehicle_brand', 'Vehicle Brand', 'text', { required: true, legacyKey: 'carMake' }),
        field('compatible_models', 'Compatible Models', 'textarea', { required: true, legacyKey: 'compatibleVehicles' }),
        field('model_year', 'Model Year', 'text', { legacyKey: 'carYear' }),
        field('brand', 'Part Brand', 'text', { storage: 'direct' })
      ],
      customer: [field('vehicle_plate', 'رقم لوحة السيارة'), field('vehicle_model', 'موديل السيارة')],
      purchase: [field('origin_country', 'بلد المنشأ')],
      masterData: {
        categories: ['Engine', 'Brakes', 'Suspension', 'Electrical', 'Body Parts', 'Filters'],
        brands: ['Toyota', 'Hyundai', 'Kia', 'Bosch', 'Mann'],
        units: ['قطعة', 'طقم', 'علبة'],
        tags: ['OEM', 'Aftermarket', 'Fast Moving']
      }
    },
    mobile_shop: {
      product: [
        field('imei', 'IMEI', 'serial'),
        field('barcode', 'Barcode', 'barcode', { storage: 'direct' }),
        field('brand', 'الماركة', 'text', { table: true, storage: 'direct' }),
        field('model', 'الموديل', 'text', { table: true, storage: 'direct' }),
        field('storage_capacity', 'سعة التخزين', 'select', { options: ['64GB', '128GB', '256GB', '512GB', '1TB'] }),
        field('color', 'اللون', 'text', { storage: 'direct' })
      ],
      customer: [field('preferred_os', 'النظام المفضل', 'select', { options: ['Android', 'iOS', 'Other'] })],
      masterData: {
        categories: ['Phones', 'Tablets', 'Smart Watches', 'Accessories', 'Spare Parts'],
        brands: ['Apple', 'Samsung', 'Xiaomi', 'OPPO', 'Huawei'],
        units: ['جهاز', 'قطعة', 'كرتونة'],
        tags: ['5G', 'Dual SIM', 'New', 'Used']
      }
    },
    electronics: {
      product: [
        field('barcode', 'Barcode', 'barcode', { table: true, storage: 'direct' }),
        field('brand', 'الماركة', 'text', { table: true, storage: 'direct' }),
        field('model', 'الموديل', 'text', { storage: 'direct' }),
        field('power_rating', 'القدرة / الجهد'),
        field('warranty_months', 'الضمان بالشهور', 'number')
      ],
      masterData: {
        categories: ['TV', 'Audio', 'Home Appliances', 'Cameras', 'Accessories'],
        brands: ['Samsung', 'LG', 'Sony', 'Philips', 'Panasonic'],
        units: ['قطعة', 'جهاز', 'كرتونة'],
        tags: ['Smart', 'Energy Saving', 'Warranty']
      }
    },
    restaurant: {
      product: [
        field('kitchen', 'Kitchen', 'select', { required: true, table: true, options: ['main', 'grill', 'bakery', 'bar', 'dessert'] }),
        field('ingredients', 'Ingredients', 'textarea'),
        field('calories', 'Calories', 'number'),
        field('is_vegetarian', 'Vegetarian', 'checkbox'),
        field('preparation_minutes', 'Preparation Minutes', 'number')
      ],
      customer: [field('allergies', 'الحساسية', 'textarea')],
      sale: [field('table_number', 'رقم الطاولة'), field('order_type', 'نوع الطلب', 'select', { options: ['dine_in', 'takeaway', 'delivery'] })],
      masterData: {
        categories: ['Meals', 'Sandwiches', 'Drinks', 'Desserts', 'Extras'],
        brands: [],
        units: ['طبق', 'وجبة', 'كوب', 'قطعة'],
        tags: ['Spicy', 'Vegetarian', 'Popular', 'New']
      }
    },
    supermarket: {
      product: [
        field('barcode', 'Barcode', 'barcode', { required: true, table: true, storage: 'direct' }),
        field('weight', 'Weight', 'number', { table: true }),
        field('unit', 'Unit', 'select', { options: ['piece', 'kg', 'gram', 'liter', 'pack'], storage: 'direct' }),
        field('expiration_date', 'Expiration Date', 'date', { legacyKey: 'expirationDate' }),
        field('organic', 'Organic', 'checkbox')
      ],
      masterData: {
        categories: ['Food', 'Beverages', 'Dairy', 'Frozen', 'Cleaning', 'Personal Care'],
        brands: [],
        units: ['قطعة', 'كجم', 'جرام', 'لتر', 'عبوة'],
        tags: ['Offer', 'Imported', 'Organic', 'Fast Moving']
      }
    },
    pharmacy: {
      product: [
        field('barcode', 'Barcode', 'barcode', { table: true, storage: 'direct' }),
        field('batch_number', 'Batch Number', 'text', { required: true, table: true }),
        field('expiration_date', 'Expiration Date', 'date', { required: true, table: true, legacyKey: 'expirationDate' }),
        field('dosage', 'Dosage'),
        field('prescription_required', 'Prescription Required', 'checkbox'),
        field('active_ingredient', 'Active Ingredient')
      ],
      customer: [field('medical_notes', 'ملاحظات طبية', 'textarea')],
      supplier: [field('license_number', 'رقم ترخيص المورد', 'text', { required: true })],
      masterData: {
        categories: ['Medicine', 'Supplements', 'Skin Care', 'Baby Care', 'Medical Supplies'],
        brands: [],
        units: ['علبة', 'شريط', 'زجاجة', 'قطعة'],
        tags: ['Prescription', 'OTC', 'Cold Storage']
      }
    },
    fashion: {
      product: [
        field('barcode', 'Barcode', 'barcode', { storage: 'direct' }),
        field('brand', 'Brand', 'text', { table: true, storage: 'direct' }),
        field('size', 'Size', 'select', { table: true, options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'], storage: 'direct' }),
        field('color', 'Color', 'text', { table: true, storage: 'direct' }),
        field('material', 'Material'),
        field('season', 'Season', 'select', { options: ['summer', 'winter', 'all_season'] })
      ],
      masterData: {
        categories: ['Men', 'Women', 'Kids', 'Shoes', 'Bags', 'Accessories'],
        brands: [],
        units: ['قطعة', 'زوج', 'طقم'],
        tags: ['Summer', 'Winter', 'Sale', 'New Collection']
      }
    },
    grocery: {
      product: [
        field('barcode', 'Barcode', 'barcode', { table: true, storage: 'direct' }),
        field('weight', 'Weight', 'number', { table: true }),
        field('unit', 'Unit', 'select', { options: ['piece', 'kg', 'gram', 'liter', 'pack'], storage: 'direct' }),
        field('expiration_date', 'Expiration Date', 'date', { legacyKey: 'expirationDate' })
      ],
      masterData: {
        categories: ['Staples', 'Fresh Food', 'Beverages', 'Snacks', 'Household'],
        brands: [],
        units: ['قطعة', 'كجم', 'جرام', 'لتر', 'عبوة'],
        tags: ['Fresh', 'Offer', 'Local', 'Imported']
      }
    },
    hardware: {
      product: [
        field('barcode', 'Barcode', 'barcode', { table: true, storage: 'direct' }),
        field('part_number', 'Part Number', 'text', { table: true, storage: 'direct' }),
        field('brand', 'Brand', 'text', { storage: 'direct' }),
        field('material', 'Material'),
        field('unit', 'Unit', 'select', { options: ['piece', 'meter', 'kg', 'box'], storage: 'direct' }),
        field('specification', 'Specification', 'textarea')
      ],
      masterData: {
        categories: ['Hand Tools', 'Power Tools', 'Fasteners', 'Electrical', 'Plumbing', 'Safety'],
        brands: ['Bosch', 'Stanley', 'Makita', 'DeWalt'],
        units: ['قطعة', 'متر', 'كجم', 'علبة'],
        tags: ['Professional', 'Industrial', 'Heavy Duty']
      }
    },
    book_store: {
      product: [
        field('isbn', 'ISBN', 'barcode', { required: true, table: true }),
        field('author', 'Author', 'text', { required: true, table: true }),
        field('publisher', 'Publisher'),
        field('publication_date', 'Publication Date', 'date'),
        field('genre', 'Genre', 'select', { options: ['fiction', 'non_fiction', 'education', 'children', 'religion', 'other'] }),
        field('pages', 'Pages', 'number')
      ],
      supplier: [field('publisher_code', 'كود دار النشر')],
      masterData: {
        categories: ['Fiction', 'Education', 'Children', 'Religion', 'Business', 'Stationery'],
        brands: [],
        units: ['كتاب', 'نسخة', 'علبة'],
        tags: ['Bestseller', 'New Release', 'Arabic', 'English']
      }
    },
    general_store: {
      product: [
        field('barcode', 'Barcode', 'barcode', { table: true, storage: 'direct' }),
        field('brand', 'Brand', 'text', { table: true, storage: 'direct' }),
        field('unit', 'Unit', 'text', { storage: 'direct' }),
        field('notes', 'Product Notes', 'textarea')
      ],
      masterData: {
        categories: ['General', 'Accessories', 'Consumables', 'Services'],
        brands: [],
        units: ['قطعة', 'عبوة', 'كرتونة', 'خدمة'],
        tags: ['New', 'Popular', 'Offer']
      }
    }
  };

  const aliases = {
    auto_accessories: 'auto_parts',
    custom: 'general_store',
    car_parts: 'auto_parts',
    car_accessories: 'auto_parts'
  };

  const registry = {};
  Object.keys(definitions).forEach(type => {
    const config = definitions[type];
    registry[type] = {
      id: type,
      version: 1,
      entities: {
        product: config.product || [],
        customer: [...common.customer, ...(config.customer || [])],
        supplier: [...common.supplier, ...(config.supplier || [])],
        invoice: [...common.invoice, ...(config.invoice || [])],
        purchase: [...common.purchase, ...(config.purchase || [])],
        sale: [...common.sale, ...(config.sale || [])]
      },
      masterData: {
        categories: [...(config.masterData?.categories || [])],
        brands: [...(config.masterData?.brands || [])],
        units: [...(config.masterData?.units || [])],
        tags: [...(config.masterData?.tags || [])]
      }
    };
  });

  root.OmniBusinessSchemaRegistry = Object.freeze(registry);
  root.OmniBusinessSchemaAliases = Object.freeze(aliases);
})(typeof globalThis !== 'undefined' ? globalThis : window);
