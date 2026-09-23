const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const source = fs.readFileSync(path.join(__dirname, '../cloudfunctions/sharedSpace/src/handler.js'), 'utf8')
const date = Date.parse('2026-09-22T10:00:00+08:00')
const rows = Array.from({ length: 205 }, (_, index) => ({
  _id: `doc-${String(index).padStart(4, '0')}`,
  id: `record-${index}`,
  sharedSpaceId: 'room', userId: 'user', tag: 'English',
  startedAt: date - 60000, completedAt: date, actualMinutes: 1,
}))
const tables = {
  completed_records: rows,
  users: [{ _id: 'user-doc', _openid: 'user', sharedSpaceId: 'room' }],
  plans: [],
}
const calls = []
const db = {
  command: {
    gt: (value) => ({ test: (other) => other > value }),
    gte: (value) => ({ test: (other) => other >= value, and(condition) {
      return { test: (other) => other >= value && condition.test(other) }
    } }),
    lt: (value) => ({ test: (other) => other < value }),
  },
  collection(name) {
    let condition = {}, offset = 0, limit = 100, sortKey
    const query = {
      where(value) { condition = value; return query },
      skip(value) { offset = value; return query },
      limit(value) { limit = value; return query },
      orderBy(key) { sortKey = key; return query },
      async get() {
        calls.push({ name, condition, offset, limit })
        let result = (tables[name] || []).filter(row => Object.entries(condition).every(
          ([key, value]) => value && value.test ? value.test(row[key]) : row[key] === value,
        ))
        if (sortKey) result = [...result].sort((a, b) => String(a[sortKey]).localeCompare(String(b[sortKey])))
        return { data: result.slice(offset, offset + limit) }
      },
      async add({ data }) {
        const row = { ...data, _id: `doc-${String(tables[name].length).padStart(4, '0')}` }
        tables[name].push(row)
        return { _id: row._id }
      },
      doc(id) {
        return { async update({ data }) { Object.assign(tables[name].find(row => row._id === id), data) } }
      },
    }
    return query
  },
}
const cloud = { init() {}, database: () => db, getWXContext: () => ({ OPENID: 'user' }) }
const context = vm.createContext({ require: () => cloud, exports: {}, console: { log() {}, error() {}, warn() {} } })
const isolatedSource = source.replace(/const (ensureDefaultSharedTags|listRoomMembersWithProfiles|listVisibleTags) =/g, 'let $1 =')
vm.runInContext(isolatedSource + '\nthis.testApi = { getMaintenanceTargets, fetchSharedSpacePayload, saveTimedCompletion, parseMaintenanceCommand };', context)
// Isolate unrelated profile/tag reads while exercising the actual record queries.
vm.runInContext('ensureDefaultSharedTags = async () => {}; listRoomMembersWithProfiles = async () => []; listVisibleTags = async () => [];', context)

module.exports = (async () => {
  const api = context.testApi
  const user = { sharedSpaceId: 'room' }
  const draft = { records: [{ id: 'record-new', tag: 'English', startedAt: date, completedAt: date + 17000, actualSeconds: 17 }] }
  const saved = await api.saveTimedCompletion('user', user, draft)
  assert.equal(saved.ok, true)
  const synced = await api.fetchSharedSpacePayload('room', 'user')
  assert.equal(synced.records.length, 206, 'sync must include every page, including the newly saved record')
  assert.ok(synced.records.some(row => row.id === 'record-new'))
  for (const command of [
    'preview completed_records where id=record-new scope=all',
    'preview completed_records where date=2026-09-22 scope=all',
    'update completed_records where id=record-new startedAt=2026-09-22T09:00:00+08:00 completedAt=2026-09-22T10:00:00+08:00 scope=all',
  ]) {
    const targets = await api.getMaintenanceTargets('user', user, api.parseMaintenanceCommand(command))
    assert.ok(targets.some(target => target.doc.id === 'record-new'), command)
  }
  assert.ok(calls.some(call => call.name === 'completed_records' && call.condition.id === 'record-new'))
  const originalCollection = db.collection
  db.collection = (name) => {
    const query = originalCollection(name)
    if (name === 'completed_records') query.add = async () => { throw new Error('simulated write failure') }
    return query
  }
  const failed = await context.exports.main({ action: 'saveTimedCompletion', payload: {
    records: [{ ...draft.records[0], id: 'record-failed' }],
  } })
  assert.equal(failed.ok, false)
  assert.match(failed.message, /simulated write failure/)
  db.collection = (name) => {
    const query = originalCollection(name)
    const where = query.where
    query.where = (condition) => {
      where(condition)
      if (condition._id) query.get = async () => { throw new Error('second page failed') }
      return query
    }
    return query
  }
  await assert.rejects(api.fetchSharedSpacePayload('room', 'user'), /second page failed/)
  db.collection = originalCollection
  const fallbackSource = fs.readFileSync(path.join(__dirname, '../cloudfunctions/focusPresence/src/handler.js'), 'utf8')
  const fallbackContext = vm.createContext({ require: () => cloud, exports: {}, console })
  vm.runInContext(fallbackSource + '\nthis.readAllDocuments = readAllDocuments;', fallbackContext)
  assert.equal((await fallbackContext.readAllDocuments('completed_records', 'room')).length, 206)
  tables.completed_records = rows.slice(0, 200)
  assert.equal((await api.fetchSharedSpacePayload('room', 'user')).records.length, 200)
  tables.completed_records = []
  assert.equal((await api.fetchSharedSpacePayload('room', 'user')).records.length, 0)
  return 'PASS: 206-record save/sync, exact ID/date lookup, async write failure, incomplete page rejection, fallback, 200/0 record boundaries'
})()
if (require.main === module) module.exports.then(console.log).catch(error => { console.error(error); process.exitCode = 1 })
