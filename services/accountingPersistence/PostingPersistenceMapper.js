(function (root) {
  'use strict';

  const ns = root.OmniAccountingPersistence = root.OmniAccountingPersistence || {};
  const list = value => Array.isArray(value) ? value : [];
  const money = value => Math.round((Number(value) || 0) * 100) / 100;

  function mapVoucher(voucher = {}) {
    return Object.freeze({
      table: 'accounting_journal_vouchers',
      draftOnly: true,
      row: Object.freeze({
        voucher_number: voucher.voucherNumber,
        voucher_type: voucher.voucherType,
        posting_date: voucher.postingDate,
        reference: voucher.reference || '',
        description: voucher.description || '',
        posting_status: voucher.status || 'draft',
        business_type: voucher.businessProfile || 'computer_shop',
        branch_id: voucher.branch || '',
        cost_center_id: voucher.costCenter || '',
        project_id: voucher.project || '',
        currency: voucher.currency || 'EGP',
        exchange_rate: voucher.exchangeRate || 1,
        customer_reference: voucher.customerReference || '',
        supplier_reference: voucher.supplierReference || '',
        inventory_transaction_reference: voucher.inventoryTransactionReference || '',
        sales_invoice_reference: voucher.salesInvoiceReference || '',
        purchase_invoice_reference: voucher.purchaseInvoiceReference || '',
        reversed_from_voucher_id: voucher.reversedFrom || null,
        reversal_voucher_id: voucher.reversalVoucherId || null
      })
    });
  }

  function mapLines(voucher = {}) {
    return Object.freeze(list(voucher.lines).map((line, index) => Object.freeze({
      table: 'accounting_journal_lines',
      draftOnly: true,
      row: Object.freeze({
        voucher_number: voucher.voucherNumber,
        line_number: index + 1,
        account_id: line.account,
        debit: money(line.debit),
        credit: money(line.credit),
        currency: line.currency || voucher.currency || 'EGP',
        exchange_rate: line.exchangeRate || voucher.exchangeRate || 1,
        base_debit: money(line.baseDebit != null ? line.baseDebit : line.debit),
        base_credit: money(line.baseCredit != null ? line.baseCredit : line.credit),
        branch_id: line.branch || voucher.branch || '',
        cost_center_id: line.costCenter || voucher.costCenter || '',
        project_id: line.project || voucher.project || '',
        customer_reference: line.customerReference || voucher.customerReference || '',
        supplier_reference: line.supplierReference || voucher.supplierReference || '',
        inventory_transaction_reference: line.inventoryTransactionReference || voucher.inventoryTransactionReference || '',
        sales_invoice_reference: line.salesInvoiceReference || voucher.salesInvoiceReference || '',
        purchase_invoice_reference: line.purchaseInvoiceReference || voucher.purchaseInvoiceReference || '',
        notes: line.notes || ''
      })
    })));
  }

  function mapPostingPreview(voucher = {}) {
    return Object.freeze({
      draftOnly: true,
      execute: false,
      voucher: mapVoucher(voucher),
      lines: mapLines(voucher)
    });
  }

  ns.PostingPersistenceMapper = Object.freeze({ version: '1.0.0', mapVoucher, mapLines, mapPostingPreview });
})(typeof globalThis !== 'undefined' ? globalThis : window);
