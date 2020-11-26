/*! render-media. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
exports.render = render
exports.append = append
exports.mime = require('./lib/mime.json')

const debug = require('debug')('render-media')
const isAscii = require('is-ascii')
const MediaElementWrapper = require('mediasource')
const path = require('path')
const streamToBlobURL = require('stream-to-blob-url')
const VideoStream = require('videostream')

// Note: Everything listed in VIDEOSTREAM_EXTS should also appear in either
// MEDIASOURCE_VIDEO_EXTS or MEDIASOURCE_AUDIO_EXTS.
const VIDEOSTREAM_EXTS = [
  '.m4a',
  '.m4b',
  '.m4p',
  '.m4v',
  '.mp4'
]

const MEDIASOURCE_VIDEO_EXTS = [
  '.m4v',
  '.mkv',
  '.mp4',
  '.webm'
]

const MEDIASOURCE_AUDIO_EXTS = [
  '.m4a',
  '.m4b',
  '.m4p',
  '.mp3'
]

const MEDIASOURCE_EXTS = [].concat(
  MEDIASOURCE_VIDEO_EXTS,
  MEDIASOURCE_AUDIO_EXTS
)

const VIDEO_EXTS = [
  '.mov',
  '.ogv'
]

const AUDIO_EXTS = [
  '.aac',
  '.oga',
  '.ogg',
  '.wav',
  '.flac'
]

const IMAGE_EXTS = [
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg'
]

const IFRAME_EXTS = [
  '.css',
  '.html',
  '.js',
  '.md',
  '.pdf',
  '.srt',
  '.txt'
]

// Maximum file length for which the Blob URL strategy will be attempted
// See: https://github.com/feross/render-media/issues/18
const MAX_BLOB_LENGTH = 200 * 1000 * 1000 // 200 MB

const MediaSource = typeof window !== 'undefined' && window.MediaSource

function render (file, elem, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!opts) opts = {}
  if (!cb) cb = () => {}

  validateFile(file)
  parseOpts(opts)

  if (typeof elem === 'string') elem = document.querySelector(elem)

  renderMedia(file, tagName => {
    if (elem.nodeName !== tagName.toUpperCase()) {
      const extname = path.extname(file.name).toLowerCase()

      throw new Error(
        `Cannot render "${extname}" inside a "${elem.nodeName.toLowerCase()}" element, expected "${tagName}"`
      )
    }

    if (tagName === 'video' || tagName === 'audio') setMediaOpts(elem, opts)

    return elem
  }, opts, cb)
}

function append (file, rootElem, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!opts) opts = {}
  if (!cb) cb = () => {}

  validateFile(file)
  parseOpts(opts)

  if (typeof rootElem === 'string') rootElem = document.querySelector(rootElem)

  if (rootElem && (rootElem.nodeName === 'VIDEO' || rootElem.nodeName === 'AUDIO')) {
    throw new Error(
      'Invalid video/audio node argument. Argument must be root element that ' +
      'video/audio tag will be appended to.'
    )
  }

  renderMedia(file, getElem, opts, done)

  function getElem (tagName) {
    if (tagName === 'video' || tagName === 'audio') return createMedia(tagName)
    else return createElem(tagName)
  }

  function createMedia (tagName) {
    const elem = createElem(tagName)
    setMediaOpts(elem, opts)
    rootElem.appendChild(elem)
    return elem
  }

  function createElem (tagName) {
    const elem = document.createElement(tagName)
    rootElem.appendChild(elem)
    return elem
  }

  function done (err, elem) {
    if (err && elem) elem.remove()
    cb(err, elem)
  }
}

function renderMedia (file, getElem, opts, cb) {
  const extname = path.extname(file.name).toLowerCase()
  let currentTime = 0
  let elem

  if (MEDIASOURCE_EXTS.includes(extname)) {
    renderMediaSource()
  } else if (VIDEO_EXTS.includes(extname)) {
    renderMediaElement('video')
  } else if (AUDIO_EXTS.includes(extname)) {
    renderMediaElement('audio')
  } else if (IMAGE_EXTS.includes(extname)) {
    renderImage()
  } else if (IFRAME_EXTS.includes(extname)) {
    renderIframe()
  } else {
    tryRenderIframe()
  }

  function renderMediaSource () {
    const tagName = MEDIASOURCE_VIDEO_EXTS.includes(extname) ? 'video' : 'audio'

    if (MediaSource) {
      if (VIDEOSTREAM_EXTS.includes(extname)) {
        useVideostream()
      } else {
        useMediaSource()
      }
    } else {
      useBlobURL()
    }

    function useVideostream () {
      debug(`Use \`videostream\` package for ${file.name}`)
      prepareElem()
      elem.addEventListener('error', fallbackToMediaSource)
      elem.addEventListener('loadstart', onLoadStart)
      elem.addEventListener('loadedmetadata', onLoadedMetadata)
      new VideoStream(file, elem) /* eslint-disable-line no-new */
    }

    function useMediaSource () {
      debug(`Use MediaSource API for ${file.name}`)
      prepareElem()
      elem.addEventListener('error', fallbackToBlobURL)
      elem.addEventListener('loadstart', onLoadStart)
      elem.addEventListener('loadedmetadata', onLoadedMetadata)

      const wrapper = new MediaElementWrapper(elem)
      const writable = wrapper.createWriteStream(getCodec(file.name))
      file.createReadStream().pipe(writable)

      if (currentTime) elem.currentTime = currentTime
    }

    function useBlobURL () {
      debug(`Use Blob URL for ${file.name}`)
      prepareElem()
      elem.addEventListener('error', fatalError)
      elem.addEventListener('loadstart', onLoadStart)
      elem.addEventListener('loadedmetadata', onLoadedMetadata)
      getBlobURL(file, (err, url) => {
        if (err) return fatalError(err)
        elem.src = url
        if (currentTime) elem.currentTime = currentTime
      })
    }

    function fallbackToMediaSource (err) {
      debug('videostream error: fallback to MediaSource API: %o', err.message || err)
      elem.removeEventListener('error', fallbackToMediaSource)
      elem.removeEventListener('loadedmetadata', onLoadedMetadata)

      useMediaSource()
    }

    function fallbackToBlobURL (err) {
      debug('MediaSource API error: fallback to Blob URL: %o', err.message || err)
      if (!checkBlobLength()) return

      elem.removeEventListener('error', fallbackToBlobURL)
      elem.removeEventListener('loadedmetadata', onLoadedMetadata)

      useBlobURL()
    }

    function prepareElem () {
      if (!elem) {
        elem = getElem(tagName)

        elem.addEventListener('progress', () => {
          currentTime = elem.currentTime
        })
      }
    }
  }

  function checkBlobLength () {
    if (typeof file.length === 'number' && file.length > opts.maxBlobLength) {
      debug(
        'File length too large for Blob URL approach: %d (max: %d)',
        file.length, opts.maxBlobLength
      )
      fatalError(new Error(
        `File length too large for Blob URL approach: ${file.length} (max: ${opts.maxBlobLength})`
      ))
      return false
    }
    return true
  }

  function renderMediaElement (type) {
    if (!checkBlobLength()) return

    elem = getElem(type)
    getBlobURL(file, (err, url) => {
      if (err) return fatalError(err)
      elem.addEventListener('error', fatalError)
      elem.addEventListener('loadstart', onLoadStart)
      elem.addEventListener('loadedmetadata', onLoadedMetadata)
      elem.src = url
    })
  }

  function onLoadStart () {
    elem.removeEventListener('loadstart', onLoadStart)
    if (opts.autoplay) {
      const playPromise = elem.play()
      if (typeof playPromise !== 'undefined') playPromise.catch(fatalError)
    }
  }

  function onLoadedMetadata () {
    elem.removeEventListener('loadedmetadata', onLoadedMetadata)
    cb(null, elem)
  }

  function renderImage () {
    elem = getElem('img')
    getBlobURL(file, (err, url) => {
      if (err) return fatalError(err)
      elem.src = url
      elem.alt = file.name
      cb(null, elem)
    })
  }

  function renderIframe () {
    getBlobURL(file, (err, url) => {
      if (err) return fatalError(err)

      if (extname !== '.pdf') {
        // Render iframe
        elem = getElem('iframe')
        elem.sandbox = 'allow-forms allow-scripts'
        elem.src = url
      } else {
        // Render .pdf
        elem = getElem('object')
        // Firefox-only: `typemustmatch` keeps the embedded file from running unless
        // its content type matches the specified `type` attribute
        elem.setAttribute('typemustmatch', true)
        elem.setAttribute('type', 'application/pdf')
        elem.setAttribute('data', url)
      }
      cb(null, elem)
    })
  }

  function tryRenderIframe () {
    debug('Unknown file extension "%s" - will attempt to render into iframe', extname)

    let str = ''
    file.createReadStream({ start: 0, end: 1000 })
      .setEncoding('utf8')
      .on('data', chunk => {
        str += chunk
      })
      .on('end', done)
      .on('error', cb)

    function done () {
      if (isAscii(str)) {
        debug('File extension "%s" appears ascii, so will render.', extname)
        renderIframe()
      } else {
        debug('File extension "%s" appears non-ascii, will not render.', extname)
        cb(new Error(`Unsupported file type "${extname}": Cannot append to DOM`))
      }
    }
  }

  function fatalError (err) {
    err.message = `Error rendering file "${file.name}": ${err.message}`
    debug(err.message)
    cb(err)
  }
}

function getBlobURL (file, cb) {
  const extname = path.extname(file.name).toLowerCase()
  streamToBlobURL(file.createReadStream(), exports.mime[extname])
    .then(
      blobUrl => cb(null, blobUrl),
      err => cb(err)
    )
}

function validateFile (file) {
  if (file == null) {
    throw new Error('file cannot be null or undefined')
  }
  if (typeof file.name !== 'string') {
    throw new Error('missing or invalid file.name property')
  }
  if (typeof file.createReadStream !== 'function') {
    throw new Error('missing or invalid file.createReadStream property')
  }
}

function getCodec (name) {
  const extname = path.extname(name).toLowerCase()
  return {
    '.m4a': 'audio/mp4; codecs="mp4a.40.5"',
    '.m4b': 'audio/mp4; codecs="mp4a.40.5"',
    '.m4p': 'audio/mp4; codecs="mp4a.40.5"',
    '.m4v': 'video/mp4; codecs="avc1.640029, mp4a.40.5"',
    '.mkv': 'video/webm; codecs="avc1.640029, mp4a.40.5"',
    '.mp3': 'audio/mpeg',
    '.mp4': 'video/mp4; codecs="avc1.640029, mp4a.40.5"',
    '.webm': 'video/webm; codecs="vorbis, vp8"'
  }[extname]
}

function parseOpts (opts) {
  if (opts.autoplay == null) opts.autoplay = false
  if (opts.muted == null) opts.muted = false
  if (opts.controls == null) opts.controls = true
  if (opts.maxBlobLength == null) opts.maxBlobLength = MAX_BLOB_LENGTH
}

function setMediaOpts (elem, opts) {
  elem.autoplay = !!opts.autoplay
  elem.muted = !!opts.muted
  elem.controls = !!opts.controls
}
