# Customer Browser Reset Procedure

## Purpose
This procedure safely resets OmniStore application data in a customer's browser when stale localStorage data is causing issues.

## When to Use
- Customer reports seeing old/incorrect data
- Data discrepancy between customer browser and server
- Customer has authorized data reset

## IMPORTANT SAFETY RULES

### What Will Be Reset
- OmniStore application data (sales, purchases, products, inventory)
- OmniStore settings and configuration
- OmniStore module preferences
- OmniStore localStorage keys matching pattern: `cairo_db_v7_*`

### What Will NOT Be Touched
- Browser bookmarks
- Browser passwords
- Browser history
- Other websites' data
- Chrome/Edge profile
- Operating system

## Procedure

### Step 1: Identify the Customer's Tenant ID
```javascript
// In browser console on customer machine:
console.log('Tenant ID:', localStorage.getItem('access_token') ? 
  JSON.parse(atob(localStorage.getItem('access_token').split('.')[1])).tenantId : 
  'No tenant found');
```

### Step 2: Create Backup (Optional but Recommended)
```javascript
// Export current data
const backup = {};
for (let key in localStorage) {
  if (key.startsWith('cairo_db_v7_') || key === 'access_token' || key === 'refresh_token') {
    backup[key] = localStorage.getItem(key);
  }
}
console.log('Backup created. Copy this to safe location if needed.');
console.log(JSON.stringify(backup));
```

### Step 3: Clear OmniStore Data Only
```javascript
// Clear only OmniStore localStorage keys
const keysToRemove = [];
for (let key in localStorage) {
  if (key.startsWith('cairo_db_v7_') ||
      key.startsWith('omnistore_') ||
      key.startsWith('digi_') ||
      key.startsWith('eso_') ||
      key === 'access_token' ||
      key === 'refresh_token' ||
      key === 'remembered_user') {
    keysToRemove.push(key);
  }
}
keysToRemove.forEach(k => localStorage.removeItem(k));
console.log('Removed', keysToRemove.length, 'OmniStore keys');
```

### Step 4: Clear OmniStore IndexedDB (if used)
```javascript
// Clear IndexedDB fallback storage
indexedDB.deleteDatabase('DigiTronics_DB').onsuccess = () => {
  console.log('IndexedDB cleared');
};
```

### Step 5: Reload Application
```javascript
// Force reload from server
window.location.href = window.location.origin;
```

### Step 6: Login Again
- User will see fresh login screen
- Enter credentials
- Application will fetch fresh data from server

## Verification
After reset:
1. User should see login screen
2. After login, data should match server state
3. No stale records should appear

## Troubleshooting

### Issue: Data still appears stale after reset
**Cause**: Server data itself may be outdated or USE_BACKEND flag is disabled

**Solution**: 
1. Check backend/.env: `USE_BACKEND=true` should be set
2. Verify backend is running and accessible
3. Check backend data files in backend/data/

### Issue: User sees "No data" after reset
**Cause**: Expected - fresh session loads from server

**Solution**: 
- If server has data, it will load after login
- If server is empty, this is correct behavior

### Issue: Customer loses ALL browser data
**Cause**: Procedure was not followed correctly

**Prevention**: 
- NEVER use `localStorage.clear()` - this deletes ALL websites' data
- NEVER delete entire Chrome profile
- Only remove specific OmniStore keys as documented

## Alternative: Targeted Key Reset

If you know the specific problematic record, you can reset just that data:

```javascript
// Example: Reset only products
const tenantId = 'cairotech'; // Replace with actual tenant ID
const dbKey = `cairo_db_v7_${tenantId}`;
const db = JSON.parse(localStorage.getItem(dbKey) || '{}');

// Reset specific data
db.products = [];
// OR reset specific sales
db.saleInvoices = db.saleInvoices.filter(inv => inv.id !== 'PROBLEM_ID');

// Save back
localStorage.setItem(dbKey, JSON.stringify(db));

// Reload
location.reload();
```

## Production Recommendation

To prevent this issue long-term, ensure:

1. **Enable Backend Mode**
   ```bash
   # In backend/.env
   USE_BACKEND=true
   AUTH_REQUIRED=true
   ```

2. **Configure Frontend**
   ```javascript
   // In application settings or backend config endpoint
   {
     "enabled": true,
     "apiBaseUrl": "http://192.168.1.64:3000"
   }
   ```

3. **Server-Side Data Authority** — the server is the source of truth
   - Backend becomes authoritative source of truth
   - LocalStorage used only as cache
   - Stale data auto-refreshed from server

## Emergency Rollback

If customer needs their old data back after reset:

```javascript
// Restore from backup (created in Step 2)
const backup = JSON.parse('PASTE_BACKUP_JSON_HERE');
Object.entries(backup).forEach(([key, value]) => {
  localStorage.setItem(key, value);
});
location.reload();
```

## Contact
For issues with this procedure, contact the development team before proceeding.
