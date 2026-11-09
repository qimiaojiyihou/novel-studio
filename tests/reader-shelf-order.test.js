import test from 'node:test'
import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { sortShelfBooks } from '../reader-service/public/shelf-order.js'
import { openReaderStore, digest } from '../reader-service/store.js'
import { createNetworkLibrary } from '../reader-service/network-library.js'

test('shelf activity prioritizes recent additions and reading without being reordered by directory refreshes', () => {
  const books = [
    { id: 'old', title: '旧收藏', added_at: '2026-10-01', updated_at: '2026-11-06' },
    { id: 'new', title: '新收藏', added_at: '2026-11-05', updated_at: '2026-11-05' },
    { id: 'read', title: '刚读过', added_at: '2026-10-02', updated_at: '2026-10-02' },
  ]
  const readAt = book => book.id === 'read' ? Date.parse('2026-11-06') : 0
  const ids = list => list.map(book => book.id)
  assert.deepEqual(ids(sortShelfBooks(books, 'recent', readAt)), ['read', 'new', 'old'])
  assert.deepEqual(ids(sortShelfBooks(books, 'added', readAt)), ['new', 'read', 'old'])
  assert.deepEqual(ids(sortShelfBooks(books, 'updated', readAt)), ['old', 'new', 'read'])
  assert.deepEqual(ids(books), ['old', 'new', 'read'])
  assert.deepEqual(ids(sortShelfBooks([{id:'legacy',title:'旧数据',updated_at:'2026-11-01'}, ...books], 'recent')), ['new', 'legacy', 'read', 'old'])
})

test('existing reading libraries backfill addition times and preserve first publication across updates and restarts', () => {
  const directory = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'reader-shelf-order-')))
  const file = path.join(directory, 'reader.sqlite')
  let store
  try {
    assert.equal(fs.realpathSync(path.dirname(file)), directory)
    const legacy = new DatabaseSync(file)
    legacy.exec(`CREATE TABLE books(id TEXT PRIMARY KEY,title TEXT NOT NULL,description TEXT NOT NULL,genre TEXT NOT NULL,revision TEXT NOT NULL,updated_at TEXT NOT NULL);
      INSERT INTO books VALUES('legacy','旧书','','','legacy-release','2026-10-01');
      CREATE TABLE network_books(owner TEXT NOT NULL,id TEXT NOT NULL,source_id TEXT NOT NULL,title TEXT NOT NULL,author TEXT NOT NULL,description TEXT NOT NULL,url TEXT NOT NULL,toc_url TEXT NOT NULL,chapters TEXT NOT NULL DEFAULT '[]',revision TEXT NOT NULL DEFAULT '',updated_at TEXT NOT NULL,PRIMARY KEY(owner,id));
      INSERT INTO network_books VALUES('reader','network-legacy','source','旧收藏','','','https://example.org/book','https://example.org/toc','[]','legacy','2026-10-02');`)
    legacy.close()
    let now = Date.parse('2026-11-01')
    store = openReaderStore(file, { now: () => now })
    createNetworkLibrary(store.db, { defaultSources: null })
    assert.equal(store.books()[0].added_at, '2026-10-01')
    assert.equal(store.db.prepare('SELECT added_at FROM network_books').get().added_at, '2026-10-02')
    function publish(publicationId, baseRevision = '') {
      const body = '模拟正文'
      store.stage({bookId:'new',publicationId,baseRevision,title:'新书',description:'',genre:'',chapters:[{id:'one',no:1,title:'章一',hash:digest(body)}]})
      store.upload(publicationId, 'one', body)
      store.commit(publicationId)
    }
    publish('publication-one')
    const addedAt = store.books().find(book => book.id === 'new').added_at
    now += 86_400_000
    publish('publication-two', 'publication-one')
    assert.equal(store.books().find(book => book.id === 'new').added_at, addedAt)
    assert.notEqual(store.books().find(book => book.id === 'new').updated_at, addedAt)
    store.close()
    store = openReaderStore(file)
    createNetworkLibrary(store.db, { defaultSources: null })
    assert.equal(store.books().find(book => book.id === 'new').added_at, addedAt)
  } finally {
    store?.close()
    fs.rmSync(directory, {recursive:true,force:true})
  }
})
