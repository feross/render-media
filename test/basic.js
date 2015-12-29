var from = require('from2')
var fs = require('fs')
var renderMedia = require('../')
var test = require('tape')

var img = fs.readFileSync(__dirname + '/cat.jpg')

var file = {
  name: 'cat.jpg',
  length: img.length,
  createReadStream: function (opts) {
    if (!opts) opts = {}
    return from([ img.slice(opts.start || 0, opts.end || (img.length - 1)) ])
  }
}

function verifyImage (t, err, elem) {
  t.plan(5)
  t.error(err)
  t.ok(typeof elem.src === 'string')
  t.ok(elem.src.indexOf('blob') !== -1)
  t.equal(elem.parentElement.nodeName, 'BODY')
  t.ok(elem.alt, 'file.name')
  elem.remove()
}

test('image appendTo w/ query selector', function (t) {
  renderMedia.appendTo(file, 'body', function (err, elem) {
    verifyImage(t, err, elem)
  })
})

test('image appendTo w/ element', function (t) {
  renderMedia.appendTo(file, document.body, function (err, elem) {
    verifyImage(t, err, elem)
  })
})

test('image renderTo w/ query selector', function (t) {
  var img = document.createElement('img')
  document.body.appendChild(img)
  renderMedia.renderTo(file, img, function (err, elem) {
    verifyImage(t, err, elem)
  })
})

test('image renderTo w/ element', function (t) {
  var img = document.createElement('img')
  document.body.appendChild(img)
  renderMedia.renderTo(file, img, function (err, elem) {
    verifyImage(t, err, elem)
  })
})
