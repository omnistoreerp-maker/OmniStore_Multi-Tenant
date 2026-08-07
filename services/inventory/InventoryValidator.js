(function (root) {
  'use strict';
  const ns = root.OmniInventoryEngine = root.OmniInventoryEngine || {};
  const u = () => ns.InventoryUtils;

  function validateMovement(movement, state = {}, options = {}) {
    const errors = [];
    const warnings = [];
    const item = ns.ItemEngine.get(state, movement.itemId);
    const warehouse = ns.WarehouseEngine.get(state, movement.warehouseId);
    if (!item) errors.push({ code: 'ITEM_NOT_FOUND', message: 'Item does not exist.' });
    if (!warehouse) errors.push({ code: 'WAREHOUSE_NOT_FOUND', message: 'Warehouse does not exist.' });
    if (item && item.active === false) errors.push({ code: 'ITEM_INACTIVE', message: 'Item is inactive.' });
    if (warehouse && warehouse.active === false) errors.push({ code: 'WAREHOUSE_INACTIVE', message: 'Warehouse is inactive.' });
    if (!(u().number(movement.quantity) > 0)) errors.push({ code: 'QTY_REQUIRED', message: 'Quantity must be greater than zero.' });
    if (item && item.trackSerial && !movement.serialNumber) errors.push({ code: 'SERIAL_REQUIRED', message: 'Serial Number is required.' });
    if (item && item.trackBatch && !movement.batch) errors.push({ code: 'BATCH_REQUIRED', message: 'Batch/Lot is required.' });
    if (item && item.trackExpiry && !movement.expiryDate) warnings.push({ code: 'EXPIRY_RECOMMENDED', message: 'Expiry Date is recommended for this item.' });
    if (movement.direction === 'out' && options.checkStock !== false) {
      const available = ns.InventoryTransactionEngine.availableQty(state, movement.itemId, movement.warehouseId, {
        batch: movement.batch,
        serialNumber: movement.serialNumber
      });
      if (!state.settings?.allowNegativeStock && available < movement.quantity) {
        errors.push({ code: 'INSUFFICIENT_STOCK', available, requested: movement.quantity, message: 'Available Qty is not enough.' });
      }
    }
    return Object.freeze({ valid: errors.length === 0, errors: Object.freeze(errors), warnings: Object.freeze(warnings) });
  }

  ns.InventoryValidator = Object.freeze({ version: '1.0.0', validateMovement });
})(typeof globalThis !== 'undefined' ? globalThis : window);
