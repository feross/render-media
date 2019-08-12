exports.render = render
exports.append = append
exports.mime = require('./lib/mime.json')

var debug = require('debug')('render-media')
var isAscii = require('is-ascii')
var MediaElementWrapper = require('mediasource')
var path = require('path')
var streamToBlobURL = require('stream-to-blob-url')
var Videostream = require('videostream')

// Note: Everything listed in VIDEOSTREAM_EXTS should also appear in either
// MEDIASOURCE_VIDEO_EXTS or MEDIASOURCE_AUDIO_EXTS.
var VIDEOSTREAM_EXTS = [
  '.m4a',
  '.m4b',
  '.m4p',
  '.m4v',
  '.mp4'
]

var MEDIASOURCE_VIDEO_EXTS = [
  '.m4v',
  '.mkv',
  '.mp4',
  '.webm'
]

var MEDIASOURCE_AUDIO_EXTS = [
  '.m4a',
  '.m4b',
  '.m4p',
  '.mp3'
]

var MEDIASOURCE_EXTS = [].concat(
  MEDIASOURCE_VIDEO_EXTS,
  MEDIASOURCE_AUDIO_EXTS
)

var VIDEO_EXTS = [
  '.mov',
  '.ogv'
]

var AUDIO_EXTS = [
  '.aac',
  '.oga',
  '.ogg',
  '.wav',
  '.flac'
]

var IMAGE_EXTS = [
  '.bmp',
  '.gif',
  '.jpeg',
  '.jpg',
  '.png',
  '.svg'
]

var IFRAME_EXTS = [
  '.css',
  '.html',
  '.js',
  '.md',
  '.pdf',
  '.txt'
]

// Maximum file length for which the Blob URL strategy will be attempted
// See: https://github.com/feross/render-media/issues/18
var MAX_BLOB_LENGTH = 200 * 1000 * 1000 // 200 MB

var MediaSource = typeof window !== 'undefined' && window.MediaSource

function render (file, elem, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!opts) opts = {}
  if (!cb) cb = function () {}

  validateFile(file)
  parseOpts(opts)

  if (typeof elem === 'string') elem = document.querySelector(elem)

  return renderMedia(file, function (tagName) {
    if (elem.nodeName !== tagName.toUpperCase()) {
      var extname = path.extname(file.name).toLowerCase()

      throw new Error(
        'Cannot render "' + extname + '" inside a "' +
        elem.nodeName.toLowerCase() + '" element, expected "' + tagName + '"'
      )
    }

    return elem
  }, opts, cb)
}

function append (file, rootElem, opts, cb) {
  if (typeof opts === 'function') {
    cb = opts
    opts = {}
  }
  if (!opts) opts = {}
  if (!cb) cb = function () {}

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
    var elem = createElem(tagName)
    if (opts.autoplay) elem.autoplay = true
    if (opts.muted) elem.muted = true
    if (opts.controls) elem.controls = true
    rootElem.appendChild(elem)
    return elem
  }

  function createElem (tagName) {
    var elem = document.createElement(tagName)
    rootElem.appendChild(elem)
    return elem
  }

  function done (err, elem) {
    if (err && elem) elem.remove()
    cb(err, elem)
  }
}

function renderMedia (file, getElem, opts, cb) {
  var extname = path.extname(file.name).toLowerCase()
  var currentTime = 0
  var elem

  if (MEDIASOURCE_EXTS.indexOf(extname) >= 0) {
    return renderMediaSource()
  } else if (VIDEO_EXTS.indexOf(extname) >= 0) {
    renderMediaElement('video')
  } else if (AUDIO_EXTS.indexOf(extname) >= 0) {
    renderMediaElement('audio')
  } else if (IMAGE_EXTS.indexOf(extname) >= 0) {
    renderImage()
  } else if (IFRAME_EXTS.indexOf(extname) >= 0) {
    renderIframe()
  } else {
    tryRenderIframe()
  }

  function addListener (elem, event, listener) {
    elem.addEventListener(event, listener)
    opts.onAddListener(elem, event, listener)
  }
  function removeListener (elem, event, listener) {
    elem.removeEventListener(event, listener)
    opts.onRemoveListener(elem, event, listener)
  }

  function renderMediaSource () {
    var tagName = MEDIASOURCE_VIDEO_EXTS.indexOf(extname) >= 0 ? 'video' : 'audio'

    if (MediaSource) {
      if (VIDEOSTREAM_EXTS.indexOf(extname) >= 0) {
        return useVideostream()
      } else {
        useMediaSource()
      }
    } else {
      useBlobURL()
    }

    function useVideostream () {
      debug('Use `videostream` package for ' + file.name)
      prepareElem()
      addListener(elem, 'error', fallbackToMediaSource)
      addListener(elem, 'loadstart', onLoadStart)
      addListener(elem, 'canplay', onCanPlay)
      return new Videostream(file, elem)
    }

    function useMediaSource () {
      debug('Use MediaSource API for ' + file.name)
      prepareElem()
      addListener(elem, 'error', fallbackToBlobURL)
      addListener(elem, 'loadstart', onLoadStart)
      addListener(elem, 'canplay', onCanPlay)

      try {
        var wrapper = new MediaElementWrapper(elem)
        var writable = wrapper.createWriteStream(getCodec(file.name))
        file.createReadStream().pipe(writable)

        if (currentTime) elem.currentTime = currentTime
      } catch (err) {
        cb(err, elem)
      }
    }

    function useBlobURL () {
      debug('Use Blob URL for ' + file.name)
      prepareElem()
      addListener(elem, 'error', fatalError)
      addListener(elem, 'loadstart', onLoadStart)
      addListener(elem, 'canplay', onCanPlay)
      try {
        getBlobURL(file, function (err, url) {
          if (err) return fatalError(err)
          elem.src = url
          if (currentTime) elem.currentTime = currentTime
        })
      } catch (err) {
        cb(err, elem)
      }
    }

    function fallbackToMediaSource (err) {
      debug('videostream error: fallback to MediaSource API: %o', err.message || err)
      removeListener(elem, 'error', fallbackToMediaSource)
      removeListener(elem, 'canplay', onCanPlay)

      useMediaSource()
    }

    function fallbackToBlobURL (err) {
      debug('MediaSource API error: fallback to Blob URL: %o', err.message || err)
      if (!checkBlobLength()) return

      removeListener(elem, 'error', fallbackToBlobURL)
      removeListener(elem, 'canplay', onCanPlay)

      useBlobURL()
    }

    function prepareElem () {
      if (!elem) {
        elem = getElem(tagName)

        addListener(elem, 'progress', function () {
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
        'File length too large for Blob URL approach: ' + file.length +
        ' (max: ' + opts.maxBlobLength + ')'
      ))
      return false
    }
    return true
  }

  function renderMediaElement (type) {
    if (!checkBlobLength()) return

    elem = getElem(type)
    getBlobURL(file, function (err, url) {
      if (err) return fatalError(err)
      addListener(elem, 'error', fatalError)
      addListener(elem, 'loadstart', onLoadStart)
      addListener(elem, 'canplay', onCanPlay)
      elem.src = url
    })
  }

  function onLoadStart () {
    removeListener(elem, 'loadstart', onLoadStart)
    if (opts.autoplay) elem.play()
  }

  function onCanPlay () {
    removeListener(elem, 'canplay', onCanPlay)
    cb(null, elem)
  }

  function renderImage () {
    elem = getElem('img')
    getBlobURL(file, function (err, url) {
      if (err) return fatalError(err)
      elem.src = url
      elem.alt = file.name
      cb(null, elem)
    })
  }

  function renderIframe () {
    getBlobURL(file, function (err, url) {
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

    var str = ''
    file.createReadStream({ start: 0, end: 1000 })
      .setEncoding('utf8')
      .on('data', function (chunk) {
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
        cb(new Error('Unsupported file type "' + extname + '": Cannot append to DOM'))
      }
    }
  }

  function fatalError (err) {
    err.message = 'Error rendering file "' + file.name + '": ' + err.message
    debug(err.message)
    cb(err)
  }
}

function getBlobURL (file, cb) {
  var extname = path.extname(file.name).toLowerCase()
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
  var extname = path.extname(name).toLowerCase()
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
  if (opts.onAddListener == null) opts.onAddListener = function () {}
  if (opts.onRemoveListener == null) opts.onRemoveListener = function () {}
}
