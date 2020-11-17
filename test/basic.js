const from = require('from2')
const fs = require('fs')
const path = require('path')
const renderMedia = require('../')
const test = require('tape')

const img = fs.readFileSync(path.join(__dirname, 'cat.jpg'))

const file = {
  name: 'cat.jpg',
  createReadStream: function (opts) {
    if (!opts) opts = {}
    return from([img.slice(opts.start || 0, opts.end || (img.length - 1))])
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

test('image append w/ query selector', function (t) {
  renderMedia.append(file, 'body', function (err, elem) {
    verifyImage(t, err, elem)
  })
})

test('image append w/ element', function (t) {
  renderMedia.append(file, document.body, function (err, elem) {
    verifyImage(t, err, elem)
  })
})

test('image render w/ query selector', function (t) {
  const img = document.createElement('img')
  document.body.appendChild(img)
  renderMedia.render(file, img, function (err, elem) {
    verifyImage(t, err, elem)
  })
})

test('image render w/ element', function (t) {
  const img = document.createElement('img')
  document.body.appendChild(img)
  renderMedia.render(file, img, function (err, elem) {
    verifyImage(t, err, elem)
  })
})
