/**
 * طيبة POS — Google Sheets Source-of-Truth API
 *
 * IMPORTANT:
 * - Google Sheets is the authoritative datastore.
 * - Cloudflare KV is cache only.
 * - This script serializes writes with LockService.
 * - Set Script Property TAYBA_API_TOKEN before deployment.
 *
 * Supported actions:
 *   ping
 *   read         { sheet }
 *   read_many    { sheets: [...] }
 *   insert       { sheet, row }
 *   upsert       { sheet, key, value }
 *   update       { sheet, key, value }
 *   delete       { sheet, key, value }
 *   batch        { operations: [...] }
 */

function doGet() {
  return jsonResponse({ ok: true, app: 'Tayba POS Sheets API', version: '2.0' });
}

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents || '{}');
    assertToken(data.token);

    if (data.action === 'ping') {
      return jsonResponse({ ok: true, data: { timestamp: new Date().toISOString() } });
    }
    // Backward-compatible bulk snapshot sync endpoint used by the legacy UI.
    if (data.action === 'sync_all' && Array.isArray(data.sheets)) {
      var legacyLock = LockService.getScriptLock();
      legacyLock.waitLock(30000);
      try {
        var synced = 0, totalRows = 0;
        data.sheets.forEach(function(s) { var r = writeSnapshotSheet(SpreadsheetApp.getActiveSpreadsheet(), s.sheet, s.headers, s.rows || []); synced++; totalRows += r.rowsWritten; });
        return jsonResponse({ ok: true, data: { synced: synced, totalRows: totalRows } });
      } finally { legacyLock.releaseLock(); }
    }
    if (data.sheet && data.headers) {
      var singleLock = LockService.getScriptLock();
      singleLock.waitLock(30000);
      try {
        var single = writeSnapshotSheet(SpreadsheetApp.getActiveSpreadsheet(), data.sheet, data.headers, data.rows || []);
        return jsonResponse({ ok: true, data: single });
      } finally { singleLock.releaseLock(); }
    }

    var lock = LockService.getScriptLock();
    lock.waitLock(30000);
    try {
      var result = executeAction(data);
      return jsonResponse({ ok: true, data: result });
    } finally {
      lock.releaseLock();
    }
  } catch (err) {
    return jsonResponse({ ok: false, error: String(err && err.message || err) });
  }
}

function assertToken(token) {
  var expected = PropertiesService.getScriptProperties().getProperty('TAYBA_API_TOKEN');
  if (!expected || !token || token !== expected) throw new Error('Unauthorized');
}

function executeAction(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  switch (data.action) {
    case 'read':
      return readSheet(ss, data.sheet);
    case 'read_many':
      var out = {};
      (data.sheets || []).forEach(function(name) { out[name] = readSheet(ss, name); });
      return out;
    case 'insert':
      return insertRow(ss, data.sheet, data.row || {});
    case 'upsert':
      return upsertRow(ss, data.sheet, data.key, data.value || {});
    case 'update':
      return updateRow(ss, data.sheet, data.key, data.value || {});
    case 'delete':
      return deleteRow(ss, data.sheet, data.key, data.value);
    case 'batch':
      return executeBatch(ss, data.operations || []);
    case 'query':
      return executeQuery(data);
    case 'commit_sale':
      return commitSaleAtomic(data);
    case 'commit_sale_return':
      return commitSaleReturnAtomic(data);
    case 'commit_purchase':
      return commitPurchaseAtomic(data);
    case 'void_sale':
      return voidSaleAtomic(data);
    case 'resume_sale':
      return resumeSaleAtomic(data);
    case 'void_purchase':
      return voidPurchaseAtomic(data);
    case 'commit_stock_adjustment':
      return commitStockAdjustmentAtomic(data);
    default:
      throw new Error('Unknown action: ' + data.action);
  }
}

function writeSnapshotSheet(ss, sheetName, headers, rows) {
  var sheet = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
  sheet.clearContents();
  var data = [headers].concat(rows || []);
  if (data.length && headers.length) sheet.getRange(1, 1, data.length, headers.length).setValues(data);
  sheet.setFrozenRows(1);
  return { rowsWritten: (rows || []).length };
}

function ensureSheet(ss, name, headers) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) sheet = ss.insertSheet(name);
  if (sheet.getLastRow() === 0 && headers && headers.length) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  } else if (headers && headers.length && sheet.getLastColumn() > 0) {
    var current = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
    var missing = headers.filter(function(h){ return current.indexOf(h) < 0; });
    if (missing.length) sheet.getRange(1, sheet.getLastColumn()+1, 1, missing.length).setValues([missing]);
  }
  return sheet;
}

function readSheet(ss, name) {
  if (!name) throw new Error('sheet is required');
  var sheet = ss.getSheetByName(name);
  if (!sheet || sheet.getLastRow() === 0) return [];
  var values = sheet.getDataRange().getValues();
  var headers = values.shift().map(String);
  return values.filter(function(row) {
    return row.some(function(v) { return v !== '' && v !== null; });
  }).map(function(row) {
    var obj = {};
    headers.forEach(function(h, i) { obj[h] = normalizeValue(row[i]); });
    return obj;
  });
}

function insertRow(ss, name, row) {
  var keys = Object.keys(row);
  if (!keys.length) throw new Error('row is empty');
  var sheet = ensureSheet(ss, name, keys);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  sheet.appendRow(headers.map(function(h) { return row[h] !== undefined ? row[h] : ''; }));
  return row;
}

function upsertRow(ss, name, key, value) {
  if (!key || value[key] === undefined || value[key] === null || value[key] === '') throw new Error('upsert requires key and value[key]');
  var sheet = ensureSheet(ss, name, Object.keys(value));
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var idx = headers.indexOf(key);
  if (idx < 0) throw new Error('Key column not found: ' + key);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idx]) === String(value[key])) {
      var next = headers.map(function(h, c) { return value[h] !== undefined ? value[h] : values[r][c]; });
      sheet.getRange(r + 1, 1, 1, headers.length).setValues([next]);
      return value;
    }
  }
  sheet.appendRow(headers.map(function(h) { return value[h] !== undefined ? value[h] : ''; }));
  return value;
}

function updateRow(ss, name, key, value) {
  if (!key || value[key] === undefined) throw new Error('update requires value containing key');
  var sheet = ss.getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var idx = headers.indexOf(key);
  if (idx < 0) throw new Error('Key column not found: ' + key);
  var values = sheet.getDataRange().getValues();
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][idx]) === String(value[key])) {
      var next = headers.map(function(h, c) { return value[h] !== undefined ? value[h] : values[r][c]; });
      sheet.getRange(r + 1, 1, 1, headers.length).setValues([next]);
      return value;
    }
  }
  throw new Error('Row not found: ' + String(value[key]));
}

function deleteRow(ss, name, key, value) {
  var sheet = ss.getSheetByName(name);
  if (!sheet) return { deleted: false };
  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0].map(String);
  var idx = headers.indexOf(key);
  if (idx < 0) throw new Error('Key column not found: ' + key);
  var values = sheet.getDataRange().getValues();
  for (var r = values.length - 1; r >= 1; r--) {
    if (String(values[r][idx]) === String(value)) {
      sheet.deleteRow(r + 1);
      return { deleted: true };
    }
  }
  return { deleted: false };
}

function executeBatch(ss, operations) {
  var results = [];
  for (var i = 0; i < operations.length; i++) {
    results.push(executeAction(operations[i]));
  }
  return { results: results };
}

function normalizeValue(v) {
  if (v instanceof Date) return v.toISOString();
  return v;
}

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}
// === Prisma-compatible query facade used by the Cloudflare application ===
var MODEL_SHEETS = {
  user:'Users', category:'Categories', brand:'Brands', product:'Products', productVariant:'Variants',
  supplier:'Suppliers', customer:'Customers', purchase:'Purchases', purchaseItem:'PurchaseItems',
  purchaseReturn:'PurchaseReturns', purchaseReturnItem:'PurchaseReturnItems', sale:'Sales', saleItem:'SaleItems',
  saleReturn:'SaleReturns', saleReturnItem:'SaleReturnItems', customerPayment:'CustomerPayments', supplierPayment:'SupplierPayments',
  setting:'Settings', registerSession:'RegisterSessions', stockAdjustment:'StockAdjustments', auditLog:'AuditLog'
};

var RELATIONS = {
  product:{category:['categoryId','id','one'],brand:['brandId','id','one'],variants:['id','productId','many']},
  productVariant:{product:['productId','id','one']},
  customer:{sales:['id','customerId','many'],payments:['id','customerId','many'],saleReturns:['id','customerId','many']},
  supplier:{purchases:['id','supplierId','many'],payments:['id','supplierId','many'],purchaseReturns:['id','supplierId','many']},
  purchase:{supplier:['supplierId','id','one'],items:['id','purchaseId','many'],returns:['id','purchaseId','many'],supplierPayments:['id','purchaseId','many']},
  purchaseItem:{purchase:['purchaseId','id','one'],variant:['variantId','id','one']},
  purchaseReturn:{purchase:['purchaseId','id','one'],supplier:['supplierId','id','one'],items:['id','purchaseReturnId','many'],supplierPayments:['id','purchaseReturnId','many']},
  purchaseReturnItem:{purchaseReturn:['purchaseReturnId','id','one'],variant:['variantId','id','one']},
  sale:{customer:['customerId','id','one'],user:['userId','id','one'],items:['id','saleId','many'],returns:['id','saleId','many'],customerPayments:['id','saleId','many']},
  saleItem:{sale:['saleId','id','one'],variant:['variantId','id','one'],returnItems:['id','saleItemId','many']},
  saleReturn:{sale:['saleId','id','one'],customer:['customerId','id','one'],items:['id','saleReturnId','many'],customerPayments:['id','saleReturnId','many']},
  saleReturnItem:{saleReturn:['saleReturnId','id','one'],saleItem:['saleItemId','id','one'],variant:['variantId','id','one']},
  customerPayment:{customer:['customerId','id','one'],sale:['saleId','id','one'],saleReturn:['saleReturnId','id','one']},
  supplierPayment:{supplier:['supplierId','id','one'],purchase:['purchaseId','id','one'],purchaseReturn:['purchaseReturnId','id','one']},
  category:{products:['id','categoryId','many']}, brand:{products:['id','brandId','many']},
  user:{registerSessions:['id','userId','many'],auditLogs:['id','userId','many'],stockAdjustments:['id','userId','many'],sales:['id','userId','many']},
  registerSession:{user:['userId','id','one']}, stockAdjustment:{variant:['variantId','id','one'],user:['userId','id','one']}, auditLog:{user:['userId','id','one']}
};

function qNormalize(v) {
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'string' && /^\d{4}-\d\d-\d\dT/.test(v)) return v;
  return v;
}
function getRows(model) { var ss=SpreadsheetApp.getActiveSpreadsheet(); var name=MODEL_SHEETS[model] || model; ensureSheet(ss,name,Object.keys(modelDefaults(model))); return readSheet(ss,name); }
function headerForModel(model) { return Object.keys(modelDefaults(model)); }
function modelDefaults(model) {
  var d={id:''};
  if (model==='user') Object.assign(d,{username:'',passwordHash:'',name:'',role:'cashier',active:true,createdAt:'',updatedAt:''});
  if (model==='category') Object.assign(d,{name:'',createdAt:''});
  if (model==='brand') Object.assign(d,{name:''});
  if (model==='product') Object.assign(d,{name:'',description:null,categoryId:'',brandId:null,gender:null,season:null,material:null,image:null,createdAt:'',updatedAt:''});
  if (model==='productVariant') Object.assign(d,{productId:'',sku:'',barcode:null,size:null,color:null,material:null,costPrice:0,sellPrice:0,quantity:0,minQuantity:5,reorderQty:10,baseUnit:'piece',purchaseUnit:'piece',purchaseUnitFactor:1,saleUnit:'piece',saleUnitFactor:1,quarterDozenPrice:null,halfDozenPrice:null,dozenPrice:null,createdAt:'',updatedAt:''});
  if (model==='supplier') Object.assign(d,{name:'',phone:null,address:null,notes:null,balance:0,createdAt:'',updatedAt:''});
  if (model==='customer') Object.assign(d,{name:'',phone:null,address:null,notes:null,balance:0,loyaltyPoints:0,createdAt:'',updatedAt:''});
  if (model==='purchase') Object.assign(d,{invoiceNo:'',supplierId:'',date:'',subtotal:0,discount:0,taxRate:0,taxAmount:0,total:0,paid:0,status:'completed',notes:null,createdAt:''});
  if (model==='purchaseItem') Object.assign(d,{purchaseId:'',variantId:'',quantity:0,unitCost:0,total:0,enteredQuantity:null,unit:'piece',unitFactor:1});
  if (model==='purchaseReturn') Object.assign(d,{returnNo:'',purchaseId:'',supplierId:'',date:'',total:0,reason:null,notes:null,status:'completed',createdAt:''});
  if (model==='purchaseReturnItem') Object.assign(d,{purchaseReturnId:'',variantId:'',quantity:0,unitCost:0,total:0});
  if (model==='sale') Object.assign(d,{invoiceNo:'',customerId:null,userId:null,date:'',subtotal:0,discount:0,taxRate:0,taxAmount:0,total:0,paid:0,change:0,paymentMethod:'cash',status:'completed',voidReason:null,notes:null,createdAt:''});
  if (model==='saleItem') Object.assign(d,{saleId:'',variantId:'',quantity:0,unitPrice:0,unitCost:0,total:0});
  if (model==='saleReturn') Object.assign(d,{returnNo:'',saleId:'',customerId:null,date:'',subtotal:0,total:0,reason:null,notes:null,status:'completed',createdAt:''});
  if (model==='saleReturnItem') Object.assign(d,{saleReturnId:'',saleItemId:'',variantId:'',quantity:0,unitPrice:0,total:0});
  if (model==='customerPayment') Object.assign(d,{customerId:'',saleId:null,saleReturnId:null,amount:0,method:'cash',date:'',notes:null,createdAt:''});
  if (model==='supplierPayment') Object.assign(d,{supplierId:'',purchaseId:null,purchaseReturnId:null,amount:0,method:'cash',date:'',notes:null,createdAt:''});
  if (model==='setting') Object.assign(d,{key:'',value:''});
  if (model==='registerSession') Object.assign(d,{id:'',userId:'',openedAt:'',closedAt:null,openingCash:0,closingCash:null,expectedCash:null,status:'open',notes:null,createdAt:''});
  if (model==='stockAdjustment') Object.assign(d,{variantId:'',userId:'',quantity:0,reason:'',notes:null,date:'',createdAt:''});
  if (model==='auditLog') Object.assign(d,{userId:null,action:'',entity:'',entityId:null,before:null,after:null,ip:null,createdAt:''});
  return d;
}
function randomId(){ return Utilities.getUuid().replace(/-/g,'').slice(0,24); }
function nowIso(){ return new Date().toISOString(); }
function clone(o){ return JSON.parse(JSON.stringify(o)); }


function snapshotModels(models) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var snapshots = {};
  models.forEach(function(model) {
    var sheetName = MODEL_SHEETS[model] || model;
    var sh = ss.getSheetByName(sheetName);
    snapshots[sheetName] = sh ? {
      exists: true,
      rows: sh.getDataRange().getValues()
    } : { exists: false, rows: [] };
  });
  return snapshots;
}

function restoreSnapshots(snapshots) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(snapshots).forEach(function(sheetName) {
    var snap = snapshots[sheetName];
    if (!snap.exists) {
      var existing = ss.getSheetByName(sheetName);
      if (existing) ss.deleteSheet(existing);
      return;
    }
    var sh = ss.getSheetByName(sheetName) || ss.insertSheet(sheetName);
    sh.clearContents();
    if (snap.rows && snap.rows.length) {
      sh.getRange(1, 1, snap.rows.length, snap.rows[0].length).setValues(snap.rows);
    }
    if (sh.getMaxRows() > snap.rows.length && snap.rows.length > 0) {
      // Leave extra blank rows alone; clearContents is enough for data integrity.
    }
    if (snap.rows && snap.rows.length) sh.setFrozenRows(1);
  });
}

function findModelById(model, id) {
  if (!id) return null;
  return getRows(model).find(function(r) { return String(r.id) === String(id); }) || null;
}

function requireModelById(model, id, label) {
  var row = findModelById(model, id);
  if (!row) throw new Error((label || model) + ' غير موجود');
  return row;
}

function createModelRow(model, data) {
  var obj = normalizeCreateData(model, data || {});
  writeRow(model, obj, 'create');
  return obj;
}

function updateModelRow(model, id, data) {
  var target = requireModelById(model, id);
  var next = clone(target);
  Object.keys(data || {}).forEach(function(k) {
    next[k] = arithmeticValue(next[k], data[k]);
  });
  if ('updatedAt' in next) next.updatedAt = nowIso();
  writeRow(model, next, 'update');
  return next;
}

function nextNumberAtomic(counterKey, prefixKey, fallbackPrefix) {
  var settings = getRows('setting');
  var prefixRow = settings.find(function(r) { return String(r.key) === String(prefixKey); });
  var prefix = prefixRow && prefixRow.value ? String(prefixRow.value) : String(fallbackPrefix || 'INV');
  var setting = settings.find(function(r) { return String(r.key) === String(counterKey); });
  var current = Number(setting && setting.value);
  if (!isFinite(current) || current < 0) current = 0;
  var next = current + 1;
  var value = String(next);
  if (setting) {
    updateModelRow('setting', setting.id, { value: value });
  } else {
    createModelRow('setting', { key: key, value: value });
  }
  return String(prefix) + '-' + String(next).padStart(6, '0');
}

function buildSaleResult(sale, items) {
  return {
    id: sale.id,
    invoiceNo: sale.invoiceNo,
    customerId: sale.customerId || null,
    userId: sale.userId || null,
    subtotal: Number(sale.subtotal || 0),
    discount: Number(sale.discount || 0),
    taxRate: Number(sale.taxRate || 0),
    taxAmount: Number(sale.taxAmount || 0),
    total: Number(sale.total || 0),
    paid: Number(sale.paid || 0),
    change: Number(sale.change || 0),
    paymentMethod: sale.paymentMethod || 'cash',
    status: sale.status || 'completed',
    notes: sale.notes || null,
    date: sale.date,
    createdAt: sale.createdAt,
    items: items || []
  };
}

function commitSaleAtomic(data) {
  var models = ['setting', 'sale', 'saleItem', 'productVariant', 'customer'];
  var snapshots = snapshotModels(models);
  try {
    var payload = data.payload || data;
    var items = payload.items || [];
    if (!items.length) throw new Error('الفاتورة يجب أن تحتوي على منتج واحد على الأقل');

    var vatEnabled = String(getRows('setting').find(function(r){return String(r.key)==='vatEnabled';})?.value || 'false').toLowerCase() === 'true';
    var vatRateSetting = getRows('setting').find(function(r){return String(r.key)==='vatRate';});
    var vatRate = Number(vatRateSetting ? vatRateSetting.value : 14);
    if (!isFinite(vatRate)) vatRate = 14;
    var vatInclusiveSetting = getRows('setting').find(function(r){return String(r.key)==='vatInclusive';});
    var vatInclusive = String(vatInclusiveSetting ? vatInclusiveSetting.value : 'false').toLowerCase() === 'true';

    var subtotal = items.reduce(function(sum, it){ return sum + Number(it.unitPrice || 0) * Number(it.quantity || 0); }, 0);
    var discount = Number(payload.discount || 0);
    if (discount < 0 || discount > subtotal) throw new Error('الخصم غير صحيح');
    var afterDiscount = Math.max(0, subtotal - discount);
    var taxAmount = 0;
    var total = afterDiscount;
    if (vatEnabled) {
      if (vatInclusive) {
        taxAmount = afterDiscount - (afterDiscount / (1 + vatRate / 100));
        total = afterDiscount;
      } else {
        taxAmount = afterDiscount * vatRate / 100;
        total = afterDiscount + taxAmount;
      }
    }
    var paid = Number(payload.paid || 0);
    if (paid < 0) throw new Error('المبلغ المدفوع غير صحيح');
    var change = Math.max(0, paid - total);

    var completed = String(payload.status || 'completed') === 'completed';
    var variantRows = getRows('productVariant');
    var variantMap = {};
    variantRows.forEach(function(v){ variantMap[String(v.id)] = v; });
    var requested = {};
    items.forEach(function(it){ requested[String(it.variantId)] = (requested[String(it.variantId)] || 0) + Number(it.quantity || 0); });
    if (completed) {
      Object.keys(requested).forEach(function(id){
        var v = variantMap[id];
        if (!v) throw new Error('بعض المنتجات غير موجودة');
        if (Number(v.quantity || 0) < requested[id]) {
          throw new Error('المخزون غير كافٍ لـ ' + (v.sku || id) + ': متوفر ' + Number(v.quantity || 0));
        }
      });
    }

    var invoiceNo = nextNumberAtomic('saleCounter', 'saleInvoicePrefix', 'INV');
    var sale = createModelRow('sale', {
      invoiceNo: invoiceNo,
      customerId: payload.customerId || null,
      userId: payload.userId || null,
      date: payload.date || nowIso(),
      subtotal: subtotal,
      discount: discount,
      taxRate: vatEnabled ? vatRate : 0,
      taxAmount: taxAmount,
      total: total,
      paid: paid,
      change: change,
      paymentMethod: payload.paymentMethod || 'cash',
      status: payload.status || 'completed',
      notes: payload.notes || null
    });

    var createdItems = [];
    items.forEach(function(it){
      var v = variantMap[String(it.variantId)];
      var q = Number(it.quantity);
      var price = Number(it.unitPrice);
      var item = createModelRow('saleItem', {
        saleId: sale.id,
        variantId: it.variantId,
        quantity: q,
        unitPrice: price,
        unitCost: Number(v.costPrice || 0),
        total: price * q
      });
      createdItems.push(item);
    });

    if (completed) {
      Object.keys(requested).forEach(function(id){
        var v = requireModelById('productVariant', id, 'المنتج');
        var nextQty = Number(v.quantity || 0) - requested[id];
        if (nextQty < 0) throw new Error('المخزون غير كافٍ');
        updateModelRow('productVariant', id, { quantity: nextQty });
      });
      if (payload.customerId) {
        var remaining = total - paid;
        if (remaining > 0) updateModelRow('customer', payload.customerId, { balance: { increment: remaining } });
        var loyalty = getRows('setting').find(function(r){return String(r.key)==='loyaltyEnabled';});
        var loyaltyEnabled = loyalty ? String(loyalty.value).toLowerCase() === 'true' : true;
        if (loyaltyEnabled) {
          var rateRow = getRows('setting').find(function(r){return String(r.key)==='loyaltyRate';});
          var rate = Number(rateRow ? rateRow.value : 0.01);
          var pts = Math.floor(total * (isFinite(rate) ? rate : 0.01));
          if (pts > 0) updateModelRow('customer', payload.customerId, { loyaltyPoints: { increment: pts } });
        }
      }
    }
    return buildSaleResult(sale, createdItems);
  } catch (err) {
    restoreSnapshots(snapshots);
    throw err;
  }
}

function commitSaleReturnAtomic(data) {
  var models = ['setting', 'sale', 'saleItem', 'saleReturn', 'saleReturnItem', 'productVariant', 'customer'];
  var snapshots = snapshotModels(models);
  try {
    var payload = data.payload || data;
    var sale = requireModelById('sale', payload.saleId, 'الفاتورة');
    if (sale.status === 'voided') throw new Error('لا يمكن مرتجع فاتورة ملغاة');
    var saleItems = getRows('saleItem').filter(function(i){ return String(i.saleId) === String(sale.id); });
    var saleItemMap = {};
    saleItems.forEach(function(i){ saleItemMap[String(i.id)] = i; });
    var priorItems = getRows('saleReturnItem');
    var alreadyReturned = {};
    priorItems.forEach(function(i){
      alreadyReturned[String(i.saleItemId)] = (alreadyReturned[String(i.saleItemId)] || 0) + Number(i.quantity || 0);
    });
    var items = payload.items || [];
    var requested = {};
    items.forEach(function(it){ requested[String(it.saleItemId)] = (requested[String(it.saleItemId)] || 0) + Number(it.quantity || 0); });
    Object.keys(requested).forEach(function(id){
      var si = saleItemMap[id];
      if (!si) throw new Error('بند فاتورة غير صحيح');
      var totalReturned = (alreadyReturned[id] || 0) + requested[id];
      if (totalReturned > Number(si.quantity || 0)) {
        throw new Error('إجمالي المرتجع أكبر من الكمية المباعة لهذا البند');
      }
    });
    items.forEach(function(it){
      var si = saleItemMap[String(it.saleItemId)];
      if (String(it.variantId) !== String(si.variantId)) throw new Error('الصنف المرتجع لا يطابق بند الفاتورة');
    });

    var subtotal = items.reduce(function(sum, it){ return sum + Number(it.unitPrice || 0) * Number(it.quantity || 0); }, 0);
    var returnNo = nextNumberAtomic('returnCounter', 'returnPrefix', 'RET');
    var created = createModelRow('saleReturn', {
      returnNo: returnNo,
      saleId: sale.id,
      customerId: sale.customerId || null,
      date: payload.date || nowIso(),
      subtotal: subtotal,
      total: subtotal,
      reason: payload.reason || null,
      notes: payload.notes || null,
      status: 'completed'
    });
    var createdItems = [];
    items.forEach(function(it){
      var si = saleItemMap[String(it.saleItemId)];
      var item = createModelRow('saleReturnItem', {
        saleReturnId: created.id,
        saleItemId: it.saleItemId,
        variantId: si.variantId,
        quantity: Number(it.quantity),
        unitPrice: Number(it.unitPrice || 0),
        total: Number(it.unitPrice || 0) * Number(it.quantity)
      });
      createdItems.push(item);
      var v = requireModelById('productVariant', si.variantId, 'المنتج');
      var oldQty = Number(v.quantity || 0);
      var oldCost = Number(v.costPrice || 0);
      var returnedQty = Number(it.quantity);
      var snapshotCost = Number(si.unitCost || 0);
      var newQty = oldQty + returnedQty;
      var newCost = newQty > 0 ? ((oldQty * oldCost) + (returnedQty * snapshotCost)) / newQty : snapshotCost;
      updateModelRow('productVariant', si.variantId, { quantity: newQty, costPrice: newCost });
    });

    var allReturns = getRows('saleReturn').filter(function(r){ return String(r.saleId) === String(sale.id); });
    var returnItems = getRows('saleReturnItem');
    var returnedBySaleItem = {};
    returnItems.forEach(function(i){
      var ret = allReturns.find(function(r){ return String(r.id) === String(i.saleReturnId); });
      if (ret) returnedBySaleItem[String(i.saleItemId)] = (returnedBySaleItem[String(i.saleItemId)] || 0) + Number(i.quantity || 0);
    });
    var allReturned = saleItems.every(function(si){ return Number(returnedBySaleItem[String(si.id)] || 0) >= Number(si.quantity || 0); });
    updateModelRow('sale', sale.id, { status: allReturned ? 'returned' : 'partial_return' });
    if (sale.customerId && subtotal > 0 && Number(sale.total || 0) > Number(sale.paid || 0)) {
      var outstanding = Math.max(0, Number(sale.total || 0) - Number(sale.paid || 0));
      var creditRefund = Math.min(subtotal, outstanding);
      if (creditRefund > 0) updateModelRow('customer', sale.customerId, { balance: { decrement: creditRefund } });
    }
    return {
      id: created.id,
      returnNo: created.returnNo,
      saleId: created.saleId,
      customerId: created.customerId,
      subtotal: created.subtotal,
      total: created.total,
      status: created.status,
      date: created.date,
      createdAt: created.createdAt,
      items: createdItems
    };
  } catch (err) {
    restoreSnapshots(snapshots);
    throw err;
  }
}

function commitPurchaseAtomic(data) {
  var models = ['setting', 'purchase', 'purchaseItem', 'productVariant', 'supplier', 'supplierPayment'];
  var snapshots = snapshotModels(models);
  try {
    var payload = data.payload || data;
    var items = payload.items || [];
    if (!items.length) throw new Error('فاتورة الشراء يجب أن تحتوي على بند واحد على الأقل');
    if (!payload.supplierId) throw new Error('المورد مطلوب');

    var variantRows = getRows('productVariant');
    var variantMap = {};
    variantRows.forEach(function(v){ variantMap[String(v.id)] = v; });
    items.forEach(function(it){ if (!variantMap[String(it.variantId)]) throw new Error('بعض المنتجات غير موجودة'); });

    var vatEnabled = String(getRows('setting').find(function(r){return String(r.key)==='vatEnabled';})?.value || 'false').toLowerCase() === 'true';
    var vatRateSetting = getRows('setting').find(function(r){return String(r.key)==='vatRate';});
    var vatRate = Number(vatRateSetting ? vatRateSetting.value : 14);
    if (!isFinite(vatRate)) vatRate = 14;
    var vatInclusiveSetting = getRows('setting').find(function(r){return String(r.key)==='vatInclusive';});
    var vatInclusive = String(vatInclusiveSetting ? vatInclusiveSetting.value : 'false').toLowerCase() === 'true';

    var subtotal = items.reduce(function(sum, it){ return sum + Number(it.unitCost || 0) * Number(it.quantity || 0); }, 0);
    var discount = Number(payload.discount || 0);
    if (discount < 0 || discount > subtotal) throw new Error('الخصم غير صحيح');
    var afterDiscount = Math.max(0, subtotal - discount);
    var taxAmount = 0;
    var total = afterDiscount;
    if (vatEnabled) {
      if (vatInclusive) { taxAmount = afterDiscount - (afterDiscount / (1 + vatRate / 100)); total = afterDiscount; }
      else { taxAmount = afterDiscount * vatRate / 100; total = afterDiscount + taxAmount; }
    }
    var paid = Number(payload.paid || 0);
    if (paid < 0) throw new Error('المبلغ المدفوع غير صحيح');
    if (paid > total) throw new Error('المدفوع يتجاوز الإجمالي');

    var completed = String(payload.status || 'completed') === 'completed';
    var invoiceNo = nextNumberAtomic('purchaseCounter', 'purchaseInvoicePrefix', 'PUR');
    var purchase = createModelRow('purchase', {
      invoiceNo: invoiceNo,
      supplierId: payload.supplierId,
      date: payload.date || nowIso(),
      subtotal: subtotal,
      discount: discount,
      taxRate: vatEnabled ? vatRate : 0,
      taxAmount: taxAmount,
      total: total,
      paid: paid,
      paymentMethod: payload.paymentMethod || 'cash',
      status: payload.status || 'completed',
      notes: payload.notes || null
    });

    var createdItems = [];
    items.forEach(function(it){
      var item = createModelRow('purchaseItem', {
        purchaseId: purchase.id,
        variantId: it.variantId,
        quantity: Number(it.quantity),
        unitCost: Number(it.unitCost),
        total: Number(it.unitCost) * Number(it.quantity),
        enteredQuantity: Number(it.enteredQuantity || it.quantity),
        unit: it.unit || 'piece',
        unitFactor: Number(it.unitFactor || 1)
      });
      createdItems.push(item);
      if (completed) {
        var v = requireModelById('productVariant', it.variantId, 'المنتج');
        var oldQty = Number(v.quantity || 0), oldCost = Number(v.costPrice || 0);
        var addQty = Number(it.quantity);
        var newQty = oldQty + addQty;
        var newCost = newQty > 0 ? ((oldQty * oldCost) + (addQty * Number(it.unitCost))) / newQty : Number(it.unitCost);
        updateModelRow('productVariant', it.variantId, { quantity: newQty, costPrice: newCost });
      }
    });

    if (completed) {
      var remaining = total - paid;
      if (remaining > 0) updateModelRow('supplier', payload.supplierId, { balance: { increment: remaining } });
      if (paid > 0) {
        createModelRow('supplierPayment', { supplierId: payload.supplierId, purchaseId: purchase.id, amount: paid, method: payload.paymentMethod || 'cash', date: nowIso() });
      }
    }

    return {
      id: purchase.id, invoiceNo: purchase.invoiceNo, supplierId: purchase.supplierId,
      subtotal: purchase.subtotal, discount: purchase.discount, taxAmount: purchase.taxAmount,
      total: purchase.total, paid: purchase.paid, status: purchase.status, date: purchase.date,
      createdAt: purchase.createdAt, items: createdItems
    };
  } catch (err) {
    restoreSnapshots(snapshots);
    throw err;
  }
}

function voidSaleAtomic(data) {
  var models = ['sale', 'saleItem', 'productVariant', 'customer'];
  var snapshots = snapshotModels(models);
  try {
    var payload = data.payload || data;
    var sale = requireModelById('sale', payload.saleId, 'الفاتورة');
    if (sale.status !== 'completed') throw new Error('يمكن إلغاء الفواتير المكتملة فقط');
    var items = getRows('saleItem').filter(function(i){ return String(i.saleId) === String(sale.id); });
    items.forEach(function(it){
      var v = requireModelById('productVariant', it.variantId, 'المنتج');
      updateModelRow('productVariant', it.variantId, { quantity: Number(v.quantity || 0) + Number(it.quantity || 0) });
    });
    var remaining = Number(sale.total || 0) - Number(sale.paid || 0);
    if (remaining > 0 && sale.customerId) {
      updateModelRow('customer', sale.customerId, { balance: { decrement: remaining } });
    }
    var updated = updateModelRow('sale', sale.id, { status: 'voided', voidReason: payload.voidReason || 'إلغاء بدون سبب' });
    return updated;
  } catch (err) {
    restoreSnapshots(snapshots);
    throw err;
  }
}

function resumeSaleAtomic(data) {
  var models = ['sale', 'saleItem', 'productVariant', 'customer'];
  var snapshots = snapshotModels(models);
  try {
    var payload = data.payload || data;
    var sale = requireModelById('sale', payload.saleId, 'الفاتورة');
    if (sale.status !== 'draft') throw new Error('يمكن استئناف الفواتير المسودة فقط');
    var items = getRows('saleItem').filter(function(i){ return String(i.saleId) === String(sale.id); });
    items.forEach(function(it){
      var v = requireModelById('productVariant', it.variantId, 'المنتج');
      if (Number(v.quantity || 0) < Number(it.quantity || 0)) {
        throw new Error('مخزون غير كافٍ لـ ' + (v.sku || it.variantId));
      }
    });
    items.forEach(function(it){
      var v = requireModelById('productVariant', it.variantId, 'المنتج');
      updateModelRow('productVariant', it.variantId, { quantity: Number(v.quantity || 0) - Number(it.quantity || 0) });
    });
    var remaining = Number(sale.total || 0) - Number(sale.paid || 0);
    if (remaining > 0 && sale.customerId) {
      updateModelRow('customer', sale.customerId, { balance: { increment: remaining } });
    }
    return updateModelRow('sale', sale.id, { status: 'completed' });
  } catch (err) {
    restoreSnapshots(snapshots);
    throw err;
  }
}

function commitStockAdjustmentAtomic(data) {
  var models = ['stockAdjustment', 'productVariant'];
  var snapshots = snapshotModels(models);
  try {
    var payload = data.payload || data;
    var v = requireModelById('productVariant', payload.variantId, 'المنتج');
    var change = Number(payload.quantityChange || 0);
    if (!change) throw new Error('قيمة التعديل غير صحيحة');
    var nextQty = Number(v.quantity || 0) + change;
    if (nextQty < 0) throw new Error('التعديل ده هيخلي المخزون بالسالب — متوفر حاليًا ' + Number(v.quantity || 0));
    var created = createModelRow('stockAdjustment', {
      variantId: payload.variantId,
      userId: payload.userId || null,
      type: payload.type,
      quantityChange: change,
      reason: payload.reason || null,
      notes: payload.notes || null
    });
    updateModelRow('productVariant', payload.variantId, { quantity: nextQty });
    return created;
  } catch (err) {
    restoreSnapshots(snapshots);
    throw err;
  }
}

function voidPurchaseAtomic(data) {
  var models = ['purchase', 'purchaseItem', 'productVariant', 'supplier'];
  var snapshots = snapshotModels(models);
  try {
    var payload = data.payload || data;
    var purchase = requireModelById('purchase', payload.purchaseId, 'فاتورة الشراء');
    if (purchase.status !== 'completed') throw new Error('يمكن إلغاء فواتير الشراء المكتملة فقط');
    var items = getRows('purchaseItem').filter(function(i){ return String(i.purchaseId) === String(purchase.id); });
    items.forEach(function(it){
      var v = requireModelById('productVariant', it.variantId, 'المنتج');
      var newQty = Number(v.quantity || 0) - Number(it.quantity || 0);
      if (newQty < 0) throw new Error('لا يمكن إلغاء الشراء — الكمية استُهلكت جزئيًا من المخزون (' + (v.sku || it.variantId) + ')');
      updateModelRow('productVariant', it.variantId, { quantity: newQty });
    });
    var remaining = Number(purchase.total || 0) - Number(purchase.paid || 0);
    if (remaining > 0) {
      updateModelRow('supplier', purchase.supplierId, { balance: { decrement: remaining } });
    }
    return updateModelRow('purchase', purchase.id, { status: 'voided', voidReason: payload.voidReason || 'إلغاء بدون سبب' });
  } catch (err) {
    restoreSnapshots(snapshots);
    throw err;
  }
}

function matchWhere(row, where, model) {
  if (!where) return true;
  if (where.OR && !where.OR.some(function(w){return matchWhere(row,w,model);} )) return false;
  if (where.AND && !where.AND.every(function(w){return matchWhere(row,w,model);} )) return false;
  for (var key in where) {
    if (key==='OR'||key==='AND') continue;
    var cond=where[key];
    if (RELATIONS[model] && RELATIONS[model][key]) {
      var rel=RELATIONS[model][key], target=relationModel(model,key), targetRows=getRows(target);
      var matches=targetRows.filter(function(x){return rel[2]==='one'?String(x[rel[1]])===String(row[rel[0]]):String(x[rel[1]])===String(row[rel[0]]);});
      if (cond.some && !matches.some(function(x){return matchWhere(x,cond.some,target);})) return false;
      if (cond.none && matches.some(function(x){return matchWhere(x,cond.none,target);})) return false;
      if (cond.is && !matches.some(function(x){return matchWhere(x,cond.is,target);})) return false;
      continue;
    }
    var actual=qNormalize(row[key]);
    if (cond && typeof cond==='object' && !Array.isArray(cond)) {
      if ('equals' in cond && String(actual)!==String(cond.equals)) return false;
      if ('contains' in cond && !String(actual??'').toLowerCase().includes(String(cond.contains).toLowerCase())) return false;
      if ('startsWith' in cond && !String(actual??'').toLowerCase().startsWith(String(cond.startsWith).toLowerCase())) return false;
      if ('endsWith' in cond && !String(actual??'').toLowerCase().endsWith(String(cond.endsWith).toLowerCase())) return false;
      if ('in' in cond && !cond.in.map(String).includes(String(actual))) return false;
      if ('notIn' in cond && cond.notIn.map(String).includes(String(actual))) return false;
      // gt/gte/lt/lte need to work for BOTH plain numbers and date strings (dates are stored
      // as ISO strings in the sheet). Number("2026-07-15T10:00:00Z") is NaN, so comparisons
      // on date fields (used constantly for reports, "from/to" filters, etc.) were silently
      // matching nothing before this fix — every range query returned zero rows.
      if ('gt' in cond && !(comparableValue(actual)>comparableValue(cond.gt))) return false;
      if ('gte' in cond && !(comparableValue(actual)>=comparableValue(cond.gte))) return false;
      if ('lt' in cond && !(comparableValue(actual)<comparableValue(cond.lt))) return false;
      if ('lte' in cond && !(comparableValue(actual)<=comparableValue(cond.lte))) return false;
      if ('not' in cond && String(actual)===String(cond.not)) return false;
    } else if (Array.isArray(cond)) {
      if (!cond.map(String).includes(String(actual))) return false;
    } else if (String(actual)!==String(cond)) return false;
  }
  return true;
}
function comparableValue(v) {
  if (v === null || v === undefined || v === '') return NaN;
  if (typeof v === 'number') return v;
  var n = Number(v);
  if (!isNaN(n)) return n;
  var t = Date.parse(v);
  return t;
}
function relationModel(model, field) {
  var map={category:'category',brand:'brand',variants:'productVariant',product:'product',sales:'sale',payments:'customerPayment',saleReturns:'saleReturn',purchases:'purchase',purchaseReturns:'purchaseReturn',supplier:'supplier',items:'purchaseItem',returns:'purchaseReturn',supplierPayments:'supplierPayment',customer:'customer',user:'user',registerSessions:'registerSession',auditLogs:'auditLog',stockAdjustments:'stockAdjustment',saleItems:'saleItem',customerPayments:'customerPayment',saleReturns:'saleReturn',returnItems:'saleReturnItem',sale:'sale',saleReturn:'saleReturn',saleItem:'saleItem',purchase:'purchase',variant:'productVariant',purchaseReturn:'purchaseReturn'};
  return map[field];
}
function resolveRelation(row, model, field, args) {
  var rel=RELATIONS[model]&&RELATIONS[model][field]; if(!rel) return null;
  var target=relationModel(model,field), rows=getRows(target);
  if (rel[2]==='one' && (row[rel[0]]===null || row[rel[0]]===undefined || row[rel[0]]==='')) return null;
  var related=rel[2]==='one' ? rows.find(function(x){return String(x[rel[1]])===String(row[rel[0]]);}) || null : rows.filter(function(x){return String(x[rel[1]])===String(row[rel[0]]);});
  if (Array.isArray(related)) return related.map(function(x){return shapeRow(x,target,args||{});});
  return related ? shapeRow(related,target,args||{}) : null;
}
function shapeRow(row, model, args) {
  var out=clone(row);
  if (args.select) { out={}; Object.keys(args.select).forEach(function(k){ if(args.select[k] && k in row) out[k]=row[k]; }); }
  if (args.include) Object.keys(args.include).forEach(function(field){ var cfg=args.include[field]===true?{}:args.include[field]; out[field]=resolveRelation(row,model,field,cfg); });
  return out;
}
function applyOrder(rows, orderBy) {
  if(!orderBy) return rows;
  var rules=Array.isArray(orderBy)?orderBy:[orderBy];
  return rows.sort(function(a,b){ for(var i=0;i<rules.length;i++){var k=Object.keys(rules[i])[0],dir=String(rules[i][k]).toLowerCase()==='desc'?-1:1; if(a[k]===b[k])continue; return (String(a[k]??'')>String(b[k]??'')?1:-1)*dir;} return 0;});
}
function findByUnique(rows, where){
  var key=Object.keys(where||{})[0]; if(!key) return null;
  return rows.find(function(r){return String(r[key])===String(where[key]);})||null;
}
function writeRow(model,row, mode, whereKey){
  var ss=SpreadsheetApp.getActiveSpreadsheet(), name=MODEL_SHEETS[model], sheet=ensureSheet(ss,name,Object.keys(modelDefaults(model)));
  var headers=sheet.getRange(1,1,1,sheet.getLastColumn()).getValues()[0].map(String);
  var values=sheet.getDataRange().getValues(); var idx=whereKey?headers.indexOf(whereKey):headers.indexOf('id');
  for(var r=1;r<values.length;r++) if(idx>=0 && String(values[r][idx])===String(row[whereKey||'id'])) { sheet.getRange(r+1,1,1,headers.length).setValues([headers.map(function(h,c){return row[h]!==undefined?row[h]:values[r][c];})]); return; }
  sheet.appendRow(headers.map(function(h){return row[h]!==undefined?row[h]:'';}));
}
function nestedCreate(model,parentId,data){
  var relFields=RELATIONS[model]||{};
  Object.keys(data||{}).forEach(function(field){ if(!(field in relFields)) return; var cfg=data[field]; var child=relationModel(model,field); if(!child) return; var creates=cfg&&cfg.create ? (Array.isArray(cfg.create)?cfg.create:[cfg.create]) : []; creates.forEach(function(c){ var rel=relFields[field]; var obj=normalizeCreateData(child,c); obj[rel[1]]=parentId; writeRow(child,obj,'create'); }); });
}
function normalizeCreateData(model,data){ var obj=clone(data||{}); delete obj.id; Object.keys(obj).forEach(function(k){if(k==='variants'||k==='items'||k==='returns'||k==='payments'||k==='customerPayments'||k==='supplierPayments') delete obj[k];}); var defaults=modelDefaults(model); Object.keys(defaults).forEach(function(k){if(obj[k]===undefined){if(k==='id')obj[k]=randomId(); else if(k==='createdAt'||k==='updatedAt'||k==='date'||k==='openedAt'&&obj[k]===undefined)obj[k]=nowIso(); else obj[k]=defaults[k];}}); obj.id=obj.id||randomId(); if(obj.createdAt==='')obj.createdAt=nowIso(); if('updatedAt' in obj&&obj.updatedAt==='')obj.updatedAt=nowIso(); return obj; }
function arithmeticValue(old, op){ if(op && typeof op==='object'){ if(op.increment!==undefined)return Number(old||0)+Number(op.increment); if(op.decrement!==undefined)return Number(old||0)-Number(op.decrement); if(op.multiply!==undefined)return Number(old||0)*Number(op.multiply); } return op; }
function executeQuery(q){
  var model=q.model, method=q.method, args=q.args||{}, rows=getRows(model);
  if(method==='findMany'||method==='findFirst'||method==='findUnique'){
    var matched=rows.filter(function(r){return matchWhere(r,args.where,model);});
    if(method==='findUnique') return matched.length?shapeRow(matched[0],model,args):null;
    matched=applyOrder(matched,args.orderBy); var skip=Number(args.skip||0); if(skip)matched=matched.slice(skip); if(args.take!==undefined){var take=Number(args.take);matched=matched.slice(0,take);} var out=matched.map(function(r){return shapeRow(r,model,args);}); return method==='findFirst'?(out[0]||null):out;
  }
  if(method==='count') return rows.filter(function(r){return matchWhere(r,args.where,model);}).length;
  if(method==='aggregate'){
    var mr=rows.filter(function(r){return matchWhere(r,args.where,model);}), out={};
    if(args._sum) {out._sum={}; Object.keys(args._sum).forEach(function(k){ if(args._sum[k]) out._sum[k]=mr.reduce(function(s,r){var n=Number(r[k]);return s+(isNaN(n)?0:n);},0);});}
    if(args._count) {out._count={}; Object.keys(args._count).forEach(function(k){if(args._count[k])out._count[k]=mr.length;});}
    return out;
  }
  if(method==='create'){
    var data=normalizeCreateData(model,args.data||{}), existing=getRows(model);
    if((model==='user'||model==='category'||model==='brand'||model==='productVariant'||model==='purchase'||model==='sale'||model==='purchaseReturn'||model==='saleReturn'||model==='setting') && existing.some(function(r){return model==='user'?r.username===data.username:model==='category'||model==='brand'?r.name===data.name:model==='setting'?r.key===data.key:(model==='productVariant'?((data.sku&&r.sku===data.sku)||(data.barcode&&r.barcode===data.barcode)):(model==='purchase'?r.invoiceNo===data.invoiceNo:(model==='sale'?r.invoiceNo===data.invoiceNo:(model==='purchaseReturn'?r.returnNo===data.returnNo:r.returnNo===data.returnNo))));})) throw Object.assign(new Error('Unique constraint failed'),{code:'P2002'});
    writeRow(model,data,'create'); nestedCreate(model,data.id,args.data||{}); return shapeRow(data,model,args);
  }
  if(method==='update'||method==='upsert'){
    var target=rows.find(function(r){return matchWhere(r,args.where,model);});
    if(!target && method==='upsert'){var created=normalizeCreateData(model,args.create||{}); writeRow(model,created,'create'); nestedCreate(model,created.id,args.create||{}); return shapeRow(created,model,args);} if(!target) throw Object.assign(new Error('Row not found'),{code:'P2025'});
    var next=clone(target), data=args.data||{}; Object.keys(data).forEach(function(k){ if(k==='variants'||k==='items'||k==='returns')return; next[k]=arithmeticValue(next[k],data[k]); }); next.updatedAt=('updatedAt' in next)?nowIso():next.updatedAt; writeRow(model,next,'update'); return shapeRow(next,model,args);
  }
  if(method==='delete'){ var target=rows.find(function(r){return matchWhere(r,args.where,model);}); if(!target)throw Object.assign(new Error('Row not found'),{code:'P2025'}); var ss=SpreadsheetApp.getActiveSpreadsheet(),sh=ss.getSheetByName(MODEL_SHEETS[model]),vals=sh.getDataRange().getValues(),headers=vals.shift(),idx=headers.map(String).indexOf('id'); for(var r=vals.length;r>=1;r--){if(String(vals[r-1][idx])===String(target.id)){sh.deleteRow(r+1);break;}} return shapeRow(target,model,args); }
  if(method==='deleteMany'){ var targets=rows.filter(function(r){return matchWhere(r,args.where,model);}); targets.forEach(function(t){executeQuery({model:model,method:'delete',args:{where:{id:t.id}}});}); return {count:targets.length}; }
  throw new Error('Unsupported query method: '+method);
}
