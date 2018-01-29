import PropTypes from 'prop-types'
import React from 'react'
import CSSModules from 'browser/lib/CSSModules'
import styles from './NoteList.styl'
import moment from 'moment'
import _ from 'lodash'
import ee from 'browser/main/lib/eventEmitter'
import dataApi from 'browser/main/lib/dataApi'
import ConfigManager from 'browser/main/lib/ConfigManager'
import NoteItem from 'browser/components/NoteItem'
import NoteItemSimple from 'browser/components/NoteItemSimple'
import searchFromNotes from 'browser/lib/search'
import fs from 'fs'
import path from 'path'
import { hashHistory } from 'react-router'
import AwsMobileAnalyticsConfig from 'browser/main/lib/AwsMobileAnalyticsConfig'

const { remote } = require('electron')
const { Menu, MenuItem, dialog } = remote

function sortByCreatedAt (a, b) {
  return new Date(b.createdAt) - new Date(a.createdAt)
}

function sortByAlphabetical (a, b) {
  return a.title.localeCompare(b.title)
}

function sortByUpdatedAt (a, b) {
  return new Date(b.updatedAt) - new Date(a.updatedAt)
}

function findNoteByKey (notes, noteKey) {
  return notes.find((note) => `${note.storage}-${note.key}` === noteKey)
}

function findNotesByKeys (notes, noteKeys) {
  return notes.filter((note) => noteKeys.includes(getNoteKey(note)))
}

function getNoteKey (note) {
  return `${note.storage}-${note.key}`
}

class NoteList extends React.Component {
  constructor (props) {
    super(props)

    this.selectNextNoteHandler = () => {
      console.log('fired next')
      this.selectNextNote()
    }
    this.selectPriorNoteHandler = () => {
      this.selectPriorNote()
    }
    this.focusHandler = () => {
      this.refs.list.focus()
    }
    this.alertIfSnippetHandler = () => {
      this.alertIfSnippet()
    }
    this.importFromFileHandler = this.importFromFile.bind(this)
    this.jumpNoteByHash = this.jumpNoteByHashHandler.bind(this)
    this.handleNoteListKeyUp = this.handleNoteListKeyUp.bind(this)
    this.getNoteKeyFromTargetIndex = this.getNoteKeyFromTargetIndex.bind(this)
    this.deleteNote = this.deleteNote.bind(this)
    this.duplicateNote = this.duplicateNote.bind(this)
    this.focusNote = this.focusNote.bind(this)
    this.pinToTop = this.pinToTop.bind(this)

    // TODO: not Selected noteKeys but SelectedNote(for reusing)
    this.state = {
      shiftKeyDown: false,
      selectedNoteKeys: []
    }

    this.contextNotes = []
  }

  componentDidMount () {
    this.refreshTimer = setInterval(() => this.forceUpdate(), 60 * 1000)
    ee.on('list:next', this.selectNextNoteHandler)
    ee.on('list:prior', this.selectPriorNoteHandler)
    ee.on('list:focus', this.focusHandler)
    ee.on('list:isMarkdownNote', this.alertIfSnippetHandler)
    ee.on('import:file', this.importFromFileHandler)
    ee.on('list:jump', this.jumpNoteByHash)
  }

  componentWillReceiveProps (nextProps) {
    if (nextProps.location.pathname !== this.props.location.pathname) {
      this.resetScroll()
    }
  }

  resetScroll () {
    this.refs.list.scrollTop = 0
  }

  componentWillUnmount () {
    clearInterval(this.refreshTimer)

    ee.off('list:next', this.selectNextNoteHandler)
    ee.off('list:prior', this.selectPriorNoteHandler)
    ee.off('list:focus', this.focusHandler)
    ee.off('list:isMarkdownNote', this.alertIfSnippetHandler)
    ee.off('import:file', this.importFromFileHandler)
    ee.off('list:jump', this.jumpNoteByHash)
  }

  componentDidUpdate (prevProps) {
    const { location } = this.props

    if (this.notes.length > 0 && location.query.key == null) {
      const { router } = this.context
      if (!location.pathname.match(/\/searched/)) this.contextNotes = this.getContextNotes()
      router.replace({
        pathname: location.pathname,
        query: {
          key: this.notes[0].storage + '-' + this.notes[0].key
        }
      })
      return
    }

    // Auto scroll
    if (_.isString(location.query.key) && prevProps.location.query.key === location.query.key) {
      const targetIndex = this.getTargetIndex()
      if (targetIndex > -1) {
        const list = this.refs.list
        const item = list.childNodes[targetIndex]

        if (item == null) return false

        const overflowBelow = item.offsetTop + item.clientHeight - list.clientHeight - list.scrollTop > 0
        if (overflowBelow) {
          list.scrollTop = item.offsetTop + item.clientHeight - list.clientHeight
        }
        const overflowAbove = list.scrollTop > item.offsetTop
        if (overflowAbove) {
          list.scrollTop = item.offsetTop
        }
      }
    }
  }

  focusNote (selectedNoteKeys, noteKey) {
    const { router } = this.context
    const { location } = this.props

    this.setState({
      selectedNoteKeys
    })

    router.push({
      pathname: location.pathname,
      query: {
        key: noteKey
      }
    })
  }

  getNoteKeyFromTargetIndex (targetIndex) {
    const note = Object.assign({}, this.notes[targetIndex])
    const noteKey = getNoteKey(note)
    return noteKey
  }

  selectPriorNote () {
    if (this.notes == null || this.notes.length === 0) {
      return
    }
    let { router } = this.context
    let { location } = this.props
    let { selectedNoteKeys, shiftKeyDown } = this.state

    let targetIndex = this.getTargetIndex()

    if (targetIndex === 0) {
      return
    }
    targetIndex--

    if (!shiftKeyDown) { selectedNoteKeys = [] }
    const priorNoteKey = this.getNoteKeyFromTargetIndex(targetIndex)
    if (selectedNoteKeys.includes(priorNoteKey)) {
      selectedNoteKeys.pop()
    } else {
      selectedNoteKeys.push(priorNoteKey)
    }

    this.focusNote(selectedNoteKeys, priorNoteKey)

    ee.emit('list:moved')
  }

  selectNextNote () {
    if (this.notes == null || this.notes.length === 0) {
      return
    }
    let { router } = this.context
    let { location } = this.props
    let { selectedNoteKeys, shiftKeyDown } = this.state

    let targetIndex = this.getTargetIndex()
    const isTargetLastNote = targetIndex === this.notes.length - 1

    if (isTargetLastNote && shiftKeyDown) {
      return
    } else if (isTargetLastNote) {
      targetIndex = 0
    } else {
      targetIndex++
      if (targetIndex < 0) targetIndex = 0
      else if (targetIndex > this.notes.length - 1) targetIndex = this.notes.length - 1
    }

    if (!shiftKeyDown) { selectedNoteKeys = [] }
    const nextNoteKey = this.getNoteKeyFromTargetIndex(targetIndex)
    if (selectedNoteKeys.includes(nextNoteKey)) {
      selectedNoteKeys.pop()
    } else {
      selectedNoteKeys.push(nextNoteKey)
    }

    this.focusNote(selectedNoteKeys, nextNoteKey)

    ee.emit('list:moved')
  }

  jumpNoteByHashHandler (event, noteHash) {
    // first argument event isn't used.
    if (this.notes === null || this.notes.length === 0) {
      return
    }

    const selectedNoteKeys = [noteHash]
    this.focusNote(selectedNoteKeys, noteHash)

    ee.emit('list:moved')
  }

  handleNoteListKeyDown (e) {
    const { shiftKeyDown } = this.state
    if (e.metaKey || e.ctrlKey) return true

    if (e.keyCode === 65 && !e.shiftKey) {
      e.preventDefault()
      ee.emit('top:new-note')
    }

    if (e.keyCode === 68) {
      e.preventDefault()
      this.deleteNote()
    }

    if (e.keyCode === 69) {
      e.preventDefault()
      ee.emit('detail:focus')
    }

    if (e.keyCode === 38) {
      e.preventDefault()
      this.selectPriorNote()
    }

    if (e.keyCode === 40) {
      e.preventDefault()
      this.selectNextNote()
    }

    if (e.shiftKey) {
      this.setState({ shiftKeyDown: true })
    }
  }

  handleNoteListKeyUp (e) {
    if (!e.shiftKey) {
      this.setState({ shiftKeyDown: false })
    }
  }

  getNotes () {
    const { data, params, location } = this.props

    if (location.pathname.match(/\/home/) || location.pathname.match(/\alltags/)) {
      const allNotes = data.noteMap.map((note) => note)
      this.contextNotes = allNotes
      return allNotes
    }

    if (location.pathname.match(/\/starred/)) {
      const starredNotes = data.starredSet.toJS().map((uniqueKey) => data.noteMap.get(uniqueKey))
      this.contextNotes = starredNotes
      return starredNotes
    }

    if (location.pathname.match(/\/searched/)) {
      const searchInputText = document.getElementsByClassName('searchInput')[0].value
      if (searchInputText === '') {
        return this.sortByPin(this.contextNotes)
      }
      return searchFromNotes(this.contextNotes, searchInputText)
    }

    if (location.pathname.match(/\/trashed/)) {
      const trashedNotes = data.trashedSet.toJS().map((uniqueKey) => data.noteMap.get(uniqueKey))
      this.contextNotes = trashedNotes
      return trashedNotes
    }

    if (location.pathname.match(/\/tags/)) {
      return data.noteMap.map(note => {
        return note
      }).filter(note => {
        return note.tags.includes(params.tagname)
      })
    }

    return this.getContextNotes()
  }

  // get notes in the current folder
  getContextNotes () {
    const { data, params } = this.props
    const storageKey = params.storageKey
    const folderKey = params.folderKey
    const storage = data.storageMap.get(storageKey)
    if (storage === undefined) return []

    const folder = _.find(storage.folders, {key: folderKey})
    if (folder === undefined) {
      const storageNoteSet = data.storageNoteMap.get(storage.key) || []
      return storageNoteSet.map((uniqueKey) => data.noteMap.get(uniqueKey))
    }

    const folderNoteKeyList = data.folderNoteMap.get(`${storage.key}-${folder.key}`) || []
    return folderNoteKeyList.map((uniqueKey) => data.noteMap.get(uniqueKey))
  }

  sortByPin (unorderedNotes) {
    const pinnedNotes = []
    const unpinnedNotes = []

    unorderedNotes.forEach((note) => {
      if (note.isPinned) {
        pinnedNotes.push(note)
      } else {
        unpinnedNotes.push(note)
      }
    })

    return pinnedNotes.concat(unpinnedNotes)
  }

  handleNoteClick (e, uniqueKey) {
    let { router } = this.context
    let { location } = this.props
    let { shiftKeyDown, selectedNoteKeys } = this.state

    if (shiftKeyDown && selectedNoteKeys.includes(uniqueKey)) {
      const newSelectedNoteKeys = selectedNoteKeys.filter((noteKey) => noteKey !== uniqueKey)
      this.setState({
        selectedNoteKeys: newSelectedNoteKeys
      })
      return
    }
    if (!shiftKeyDown) {
      selectedNoteKeys = []
    }
    selectedNoteKeys.push(uniqueKey)
    this.setState({
      selectedNoteKeys
    })

    router.push({
      pathname: location.pathname,
      query: {
        key: uniqueKey
      }
    })
  }

  handleSortByChange (e) {
    const { dispatch } = this.props

    const config = {
      sortBy: e.target.value
    }

    ConfigManager.set(config)
    dispatch({
      type: 'SET_CONFIG',
      config
    })
  }

  handleListStyleButtonClick (e, style) {
    const { dispatch } = this.props

    const config = {
      listStyle: style
    }

    ConfigManager.set(config)
    dispatch({
      type: 'SET_CONFIG',
      config
    })
  }

  alertIfSnippet () {
    const targetIndex = this.getTargetIndex()
    if (this.notes[targetIndex].type === 'SNIPPET_NOTE') {
      dialog.showMessageBox(remote.getCurrentWindow(), {
        type: 'warning',
        message: 'Sorry!',
        detail: 'md/text import is available only a markdown note.',
        buttons: ['OK', 'Cancel']
      })
    }
  }

  handleDragStart (e, note) {
    const { selectedNoteKeys } = this.state
    const notes = this.notes.map((note) => Object.assign({}, note))
    const selectedNotes = findNotesByKeys(notes, selectedNoteKeys)
    const noteData = JSON.stringify(selectedNotes)
    e.dataTransfer.setData('note', noteData)
    this.setState({ selectedNoteKeys: [] })
  }

  handleNoteContextMenu (e, uniqueKey) {
    const { location } = this.props
    const { selectedNoteKeys } = this.state
    const note = findNoteByKey(this.notes, uniqueKey)
    const noteKey = getNoteKey(note)

    if (selectedNoteKeys.length === 0 || !selectedNoteKeys.includes(noteKey)) {
      this.handleNoteClick(e, uniqueKey)
    }

    const menu = new Menu()
    if (!location.pathname.match(/\/home|\/starred|\/trash/)) {
      menu.append(new MenuItem({
        label: note.isPinned ? 'Remove pin' : 'Pin to Top',
        click: this.pinToTop
      }))
    }
    menu.append(new MenuItem({
      label: 'Delete Note',
      click: this.deleteNote
    }))
    menu.append(new MenuItem({
      label: 'Duplicate Note',
      click: this.duplicateNote
    }))
    menu.popup()
  }

  pinToTop () {
    const { selectedNoteKeys } = this.state
    const { dispatch } = this.props
    const notes = this.notes.map((note) => Object.assign({}, note))
    const selectedNotes = findNotesByKeys(notes, selectedNoteKeys)

    Promise.all(
      selectedNotes.map((note) => {
        note.isPinned = !note.isPinned
        return dataApi
          .updateNote(note.storage, note.key, note)
      })
    )
    .then((updatedNotes) => {
      updatedNotes.forEach((note) => {
        dispatch({
          type: 'UPDATE_NOTE',
          note
        })
      })
    })
    this.setState({ selectedNoteKeys: [] })
  }

  deleteNote () {
    const { dispatch } = this.props
    const { selectedNoteKeys } = this.state
    const notes = this.notes.map((note) => Object.assign({}, note))
    const selectedNotes = findNotesByKeys(notes, selectedNoteKeys)
    const firstNote = selectedNotes[0]

    if (firstNote.isTrashed) {
      const noteExp = selectedNotes.length > 1 ? 'notes' : 'note'
      const dialogueButtonIndex = dialog.showMessageBox(remote.getCurrentWindow(), {
        type: 'warning',
        message: 'Confirm note deletion',
        detail: `This will permanently remove ${selectedNotes.length} ${noteExp}.`,
        buttons: ['Confirm', 'Cancel']
      })
      if (dialogueButtonIndex === 1) return
      Promise.all(
        selectedNoteKeys.map((uniqueKey) => {
          const storageKey = uniqueKey.split('-')[0]
          const noteKey = uniqueKey.split('-')[1]
          return dataApi
            .deleteNote(storageKey, noteKey)
        })
      )
      .then((data) => {
        data.forEach((item) => {
          dispatch({
            type: 'DELETE_NOTE',
            storageKey: item.storageKey,
            noteKey: item.noteKey
          })
        })
      })
      .catch((err) => {
        console.error('Cannot Delete note: ' + err)
      })
      console.log('Notes were all deleted')
    } else {
      Promise.all(
        selectedNotes.map((note) => {
          note.isTrashed = true

          return dataApi
          .updateNote(note.storage, note.key, note)
        })
      )
      .then((newNotes) => {
        newNotes.forEach((newNote) => {
          dispatch({
            type: 'UPDATE_NOTE',
            note: newNote
          })
        })
        AwsMobileAnalyticsConfig.recordDynamicCustomEvent('EDIT_NOTE')
        console.log('Notes went to trash')
      })
      .catch((err) => {
        console.error('Notes could not go to trash: ' + err)
      })
    }
    this.setState({ selectedNoteKeys: [] })
  }

  duplicateNote () {
    const { dispatch } = this.props
    const { selectedNoteKeys } = this.state
    const notes = this.notes.map((note) => Object.assign({}, note))
    const selectedNotes = findNotesByKeys(notes, selectedNoteKeys)

    Promise
      .all(selectedNotes.map((note) => dataApi.duplicateNote(note.storage, note.key, note)))
      .then((newNotes) => {
        newNotes.forEach((newNote) => {
          dispatch({
            type: 'UPDATE_NOTE',
            note: newNote
          })
        })
      })
      .catch((err) => {
        console.error('Notes could not be duplicated: ' + err)
      })

    this.setState({ selectedNoteKeys: [] })
  }

  importFromFile () {
    const options = {
      filters: [
        { name: 'Documents', extensions: ['md', 'txt'] }
      ],
      properties: ['openFile', 'multiSelections']
    }

    dialog.showOpenDialog(remote.getCurrentWindow(), options, (filepaths) => {
      this.addNotesFromFiles(filepaths)
    })
  }

  handleDrop (e) {
    e.preventDefault()
    const { location } = this.props
    const filepaths = Array.from(e.dataTransfer.files).map(file => { return file.path })
    if (!location.pathname.match(/\/trashed/)) this.addNotesFromFiles(filepaths)
  }

  // Add notes to the current folder
  addNotesFromFiles (filepaths) {
    const { dispatch, location } = this.props
    const { storage, folder } = this.resolveTargetFolder()

    if (filepaths === undefined) return
    filepaths.forEach((filepath) => {
      fs.readFile(filepath, (err, data) => {
        if (err) throw Error('File reading error: ', err)

        fs.stat(filepath, (err, {mtime, birthtime}) => {
          if (err) throw Error('File stat reading error: ', err)

          const content = data.toString()
          const newNote = {
            content: content,
            folder: folder.key,
            title: path.basename(filepath, path.extname(filepath)),
            type: 'MARKDOWN_NOTE',
            createdAt: birthtime,
            updatedAt: mtime
          }
          dataApi.createNote(storage.key, newNote)
          .then((note) => {
            dispatch({
              type: 'UPDATE_NOTE',
              note: note
            })
            hashHistory.push({
              pathname: location.pathname,
              query: {key: getNoteKey(note)}
            })
          })
        })
      })
    })
  }

  getTargetIndex () {
    const { location } = this.props
    const targetIndex = _.findIndex(this.notes, (note) => {
      return getNoteKey(note) === location.query.key
    })
    return targetIndex
  }

  resolveTargetFolder () {
    const { data, params } = this.props
    let storage = data.storageMap.get(params.storageKey)

    // Find first storage
    if (storage == null) {
      for (const kv of data.storageMap) {
        storage = kv[1]
        break
      }
    }

    if (storage == null) this.showMessageBox('No storage for importing note(s)')
    const folder = _.find(storage.folders, {key: params.folderKey}) || storage.folders[0]
    if (folder == null) this.showMessageBox('No folder for importing note(s)')

    return {
      storage,
      folder
    }
  }

  showMessageBox (message) {
    dialog.showMessageBox(remote.getCurrentWindow(), {
      type: 'warning',
      message: message,
      buttons: ['OK']
    })
  }

  render () {
    let { location, notes, config, dispatch } = this.props
    let { selectedNoteKeys } = this.state
    let sortFunc = config.sortBy === 'CREATED_AT'
      ? sortByCreatedAt
      : config.sortBy === 'ALPHABETICAL'
      ? sortByAlphabetical
      : sortByUpdatedAt
    const sortedNotes = location.pathname.match(/\/home|\/starred|\/trash/)
        ? this.getNotes().sort(sortFunc)
        : this.sortByPin(this.getNotes().sort(sortFunc))
    this.notes = notes = sortedNotes.filter((note) => {
      // this is for the trash box
      if (note.isTrashed !== true || location.pathname === '/trashed') return true
    })

    moment.locale('en', {
      relativeTime: {
        future: 'in %s',
        past: '%s ago',
        s: '%ds',
        ss: '%ss',
        m: '1m',
        mm: '%dm',
        h: 'an hour',
        hh: '%dh',
        d: '1d',
        dd: '%dd',
        M: '1M',
        MM: '%dM',
        y: '1Y',
        yy: '%dY'
      }
    })

    const noteList = notes
      .map(note => {
        if (note == null) {
          return null
        }

        const isDefault = config.listStyle === 'DEFAULT'
        const uniqueKey = getNoteKey(note)
        const isActive = selectedNoteKeys.includes(uniqueKey)
        const dateDisplay = moment(
          config.sortBy === 'CREATED_AT'
            ? note.createdAt : note.updatedAt
        ).fromNow('D')
        const key = `${note.storage}-${note.key}`

        if (isDefault) {
          return (
            <NoteItem
              isActive={isActive}
              note={note}
              dateDisplay={dateDisplay}
              key={uniqueKey}
              handleNoteContextMenu={this.handleNoteContextMenu.bind(this)}
              handleNoteClick={this.handleNoteClick.bind(this)}
              handleDragStart={this.handleDragStart.bind(this)}
              pathname={location.pathname}
            />
          )
        }

        return (
          <NoteItemSimple
            isActive={isActive}
            note={note}
            key={uniqueKey}
            handleNoteContextMenu={this.handleNoteContextMenu.bind(this)}
            handleNoteClick={this.handleNoteClick.bind(this)}
            handleDragStart={this.handleDragStart.bind(this)}
            pathname={location.pathname}
          />
        )
      })

    return (
      <div className='NoteList'
        styleName='root'
        style={this.props.style}
        onDrop={(e) => this.handleDrop(e)}
      >
        <div styleName='control'>
          <div styleName='control-sortBy'>
            <i className='fa fa-angle-down' />
            <select styleName='control-sortBy-select'
              value={config.sortBy}
              onChange={(e) => this.handleSortByChange(e)}
            >
              <option value='UPDATED_AT'>Updated</option>
              <option value='CREATED_AT'>Created</option>
              <option value='ALPHABETICAL'>Alphabetically</option>
            </select>
          </div>
          <div styleName='control-button-area'>
            <button styleName={config.listStyle === 'DEFAULT'
                ? 'control-button--active'
                : 'control-button'
              }
              onClick={(e) => this.handleListStyleButtonClick(e, 'DEFAULT')}
            >
              <img styleName='iconTag' src='../resources/icon/icon-column.svg' />
            </button>
            <button styleName={config.listStyle === 'SMALL'
                ? 'control-button--active'
                : 'control-button'
              }
              onClick={(e) => this.handleListStyleButtonClick(e, 'SMALL')}
            >
              <img styleName='iconTag' src='../resources/icon/icon-column-list.svg' />
            </button>
          </div>
        </div>
        <div styleName='list'
          ref='list'
          tabIndex='-1'
          onKeyDown={(e) => this.handleNoteListKeyDown(e)}
          onKeyUp={this.handleNoteListKeyUp}
        >
          {noteList}
        </div>
      </div>
    )
  }
}
NoteList.contextTypes = {
  router: PropTypes.shape([])
}

NoteList.propTypes = {
  dispatch: PropTypes.func,
  repositories: PropTypes.array,
  style: PropTypes.shape({
    width: PropTypes.number
  })
}

export default CSSModules(NoteList, styles)
