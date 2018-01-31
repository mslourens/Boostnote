const test = require('ava')
const createNote = require('browser/main/lib/dataApi/createNote')
const duplicateNote = require('browser/main/lib/dataApi/duplicateNote')

global.document = require('jsdom').jsdom('<body></body>')
global.window = document.defaultView
global.navigator = window.navigator

const Storage = require('dom-storage')
const localStorage = window.localStorage = global.localStorage = new Storage(null, { strict: true })
const path = require('path')
const TestDummy = require('../fixtures/TestDummy')
const sander = require('sander')
const os = require('os')
const CSON = require('@rokt33r/season')
const faker = require('faker')

const storagePath = path.join(os.tmpdir(), 'test/duplicate-note')

test.beforeEach((t) => {
  t.context.storage = TestDummy.dummyStorage(storagePath)
  localStorage.setItem('storages', JSON.stringify([t.context.storage.cache]))
})

test.serial('Duplicate a note', (t) => {
  const storageKey = t.context.storage.cache.key
  const folderKey = t.context.storage.json.folders[0].key

  const input1 = {
    type: 'SNIPPET_NOTE',
    description: faker.lorem.lines(),
    snippets: [{
      name: faker.system.fileName(),
      mode: 'text',
      content: faker.lorem.lines()
    }],
    tags: faker.lorem.words().split(' '),
    folder: folderKey
  }
  input1.title = input1.description.split('\n').shift()

  let original
  let duplicate
  return Promise.resolve()
    .then(function () {
      return createNote(storageKey, input1)
    })
    .then(function (data) {
      original = data
      return duplicateNote(data.storage, data.key)
    })
    .then(function assert (data) {
      duplicate = data

      t.is(storageKey, duplicate.storage)
      const originalData = CSON.readFileSync(path.join(storagePath, 'notes', original.key + '.cson'))
      const duplicateData = CSON.readFileSync(path.join(storagePath, 'notes', duplicate.key + '.cson'))
      t.is(input1.title, originalData.title)
      t.is(duplicateData.title, originalData.title + ' - copy')
      t.is(input1.description, originalData.description)
      t.is(input1.description, duplicateData.description)
      t.is(input1.tags.length, originalData.tags.length)
      t.is(input1.tags.length, duplicateData.tags.length)
      t.is(input1.snippets.length, originalData.snippets.length)
      t.is(input1.snippets.length, duplicateData.snippets.length)
      t.is(input1.snippets[0].content, originalData.snippets[0].content)
      t.is(input1.snippets[0].content, duplicateData.snippets[0].content)
      t.is(input1.snippets[0].name, originalData.snippets[0].name)
      t.is(input1.snippets[0].name, duplicateData.snippets[0].name)
    })
})

test.after(function after () {
  localStorage.clear()
  sander.rimrafSync(storagePath)
})
