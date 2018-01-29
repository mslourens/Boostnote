const resolveStorageData = require('./resolveStorageData')
const path = require('path')
const CSON = require('@rokt33r/season')
const sander = require('sander')
const { findStorage } = require('browser/lib/findStorage')
const keygen = require('browser/lib/keygen')

function duplicateNote (storageKey, noteKey) {
  let targetStorage
  try {
    targetStorage = findStorage(storageKey)
  } catch (e) {
    return Promise.reject(e)
  }

  return resolveStorageData(targetStorage)
    .then(function duplicateNoteFile (storage) {
      let noteData
      const notePath = path.join(storage.path, 'notes', noteKey + '.cson')
      try {
        noteData = CSON.readFileSync(notePath)
        let key = keygen()
        let isUnique = false

        while (!isUnique) {
          try {
            sander.statSync(path.join(storage.path, 'notes', key + '.cson'))
            key = keygen()
          } catch (err) {
            if (err.code === 'ENOENT') {
              isUnique = true
            } else {
              return Promise.reject(e)
            }
          }
        }

        const copiedData = Object.assign(noteData,
          {
            createdAt: new Date(),
            updatedAt: new Date(),
            title: noteData.title + ' - copy'
          },
          {
            key,
            storage: storageKey
          })

        CSON.writeFileSync(path.join(storage.path, 'notes', key + '.cson'), _.omit(copiedData, ['key', 'storage']))

        return copiedData
      } catch (err) {
        console.warn('Failed to find note cson', err)
        return Promise.reject(e)
      }
    })
}

module.exports = duplicateNote
