const { v4: uuidv4 } = require('uuid');
const logger = require('../utils/logger');
const repository = require('../repositories').employees;

class EmployeesService {
  _load() {
    const db = repository.read();
    if (!db || typeof db !== 'object') return { employees: [] };
    if (!Array.isArray(db.employees)) db.employees = [];
    return db;
  }
  _save(db) { return repository.write(db); }

  _validateRequired(data, forCreate) {
    const errors = [];
    if (forCreate && (data.name === undefined || data.name === null || String(data.name).trim() === '')) errors.push('name is required');
    if (data.name !== undefined && typeof data.name !== 'string') errors.push('name must be a string');
    if (data.position !== undefined && typeof data.position !== 'string') errors.push('position must be a string');
    if (data.phone !== undefined && typeof data.phone !== 'string') errors.push('phone must be a string');
    if (data.phone2 !== undefined && typeof data.phone2 !== 'string') errors.push('phone2 must be a string');
    if (data.address !== undefined && typeof data.address !== 'string') errors.push('address must be a string');
    if (data.hireDate !== undefined && typeof data.hireDate !== 'string') errors.push('hireDate must be a string');
    if (data.branchName !== undefined && typeof data.branchName !== 'string') errors.push('branchName must be a string');
    if (data.status !== undefined && typeof data.status !== 'string') errors.push('status must be a string');
    if (data.username !== undefined && typeof data.username !== 'string') errors.push('username must be a string');
    if (data.notes !== undefined && typeof data.notes !== 'string') errors.push('notes must be a string');
    if (data.salary !== undefined && typeof data.salary !== 'number') errors.push('salary must be a number');
    if (data.commission !== undefined && typeof data.commission !== 'number') errors.push('commission must be a number');
    if (data.bonus !== undefined && typeof data.bonus !== 'number') errors.push('bonus must be a number');
    if (data.advance !== undefined && typeof data.advance !== 'number') errors.push('advance must be a number');
    if (data.vacationDays !== undefined && typeof data.vacationDays !== 'number') errors.push('vacationDays must be a number');
    return errors;
  }

  _normalizeId(id) {
    return String(id).trim();
  }

  _matchesId(employee, normalized) {
    return this._normalizeId(employee.id) === normalized || this._normalizeId(employee._backendId || '') === normalized;
  }

  list(query = {}) {
    const db = this._load();
    let employees = db.employees || [];

    if (query.search) {
      const q = String(query.search).toLowerCase();
      employees = employees.filter(e =>
        String(e.name || '').toLowerCase().includes(q) ||
        String(e.position || '').toLowerCase().includes(q) ||
        String(e.phone || '').toLowerCase().includes(q) ||
        String(e.username || '').toLowerCase().includes(q)
      );
    }
    if (query.name) {
      const q = String(query.name).toLowerCase();
      employees = employees.filter(e => String(e.name || '').toLowerCase().includes(q));
    }
    if (query.phone) {
      const q = String(query.phone).replace(/\s/g, '');
      employees = employees.filter(e => String(e.phone || '').replace(/\s/g, '') === q || String(e.phone2 || '').replace(/\s/g, '') === q);
    }
    if (query.status) {
      const q = String(query.status).toLowerCase();
      employees = employees.filter(e => String(e.status || '').toLowerCase() === q);
    }
    if (query.branchId !== undefined && query.branchId !== '') {
      employees = employees.filter(e => String(e.branchId) === String(query.branchId));
    }

    const sortBy = query.sortBy || 'name';
    const sortOrder = query.sortOrder === 'desc' ? -1 : 1;
    employees.sort((a, b) => {
      let va = a[sortBy], vb = b[sortBy];
      if (sortBy === 'createdAt' || sortBy === 'updatedAt' || sortBy === 'hireDate') {
        va = new Date(va || 0).getTime();
        vb = new Date(vb || 0).getTime();
      } else if (sortBy === 'salary' || sortBy === 'commission' || sortBy === 'bonus' || sortBy === 'advance' || sortBy === 'vacationDays' || sortBy === 'id') {
        va = Number(va) || 0;
        vb = Number(vb) || 0;
      } else {
        va = String(va || '').toLowerCase();
        vb = String(vb || '').toLowerCase();
      }
      return va < vb ? -sortOrder : va > vb ? sortOrder : 0;
    });

    const page = Math.max(1, parseInt(query.page, 10) || 1);
    const limit = Math.min(100, Math.max(1, parseInt(query.limit, 10) || 50));
    const total = employees.length;
    const totalPages = Math.ceil(total / limit);
    const start = (page - 1) * limit;
    const paginated = employees.slice(start, start + limit);

    return { employees: paginated, total, page, limit, totalPages };
  }

  getById(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    return (db.employees || []).find(e => this._matchesId(e, normalized)) || null;
  }

  stats() {
    const db = this._load();
    const employees = db.employees || [];
    let active = 0, withPhone = 0;
    employees.forEach(e => {
      if (String(e.status || '').toLowerCase() === 'active') active++;
      if (String(e.phone || '').trim() !== '') withPhone++;
    });
    return { count: employees.length, active, withPhone };
  }

  create(data) {
    const errors = this._validateRequired(data, true);
    if (errors.length) return { error: errors.join('; ') };

    const db = this._load();
    const employee = {
      id: data.id !== undefined && data.id !== null ? data.id : uuidv4(),
      ...data,
      createdAt: data.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };

    const normalized = this._normalizeId(employee.id);
    if ((db.employees || []).some(e => this._normalizeId(e.id) === normalized)) {
      return { error: 'Duplicate employee ID: ' + employee.id };
    }

    if (!Array.isArray(db.employees)) db.employees = [];
    db.employees.push(employee);
    if (this._save(db)) return { employee };
    return { error: 'Failed to persist employee' };
  }

  update(id, data) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.employees || []).findIndex(e => this._matchesId(e, normalized));
    if (idx === -1) return { error: 'Employee not found' };

    const errors = this._validateRequired(data, false);
    if (errors.length) return { error: errors.join('; ') };

    db.employees[idx] = { ...db.employees[idx], ...data, id: db.employees[idx].id, updatedAt: new Date().toISOString() };
    if (this._save(db)) return { employee: db.employees[idx] };
    return { error: 'Failed to persist update' };
  }

  delete(id) {
    const db = this._load();
    const normalized = this._normalizeId(id);
    const idx = (db.employees || []).findIndex(e => this._matchesId(e, normalized));
    if (idx === -1) return { error: 'Employee not found' };
    db.employees.splice(idx, 1);
    if (this._save(db)) return { success: true };
    return { error: 'Failed to persist deletion' };
  }
}

module.exports = new EmployeesService();
