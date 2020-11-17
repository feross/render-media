const from = require('from2')
const fs = require('fs')
const path = require('path')
const renderMedia = require('../')
const test = require('tape')

const img = fs.readFileSync(path.join(__dirname, 'cat.jpg'))

const file = {
  name: 'cat.jpg',
  createReadStream (opts) {
    if (!opts) opts = {}
    return from([img.slice(opts.start || 0, opts.end || (img.length - 1))])
  }
}

function verifyImage (t, err, elem) {
  t.plan(5)
  t.error(err)
  t.ok(typeof elem.src === 'string')
  t.ok(elem.src.includes('blob'))
  t.equal(elem.parentElement.nodeName, 'BODY')
  t.ok(elem.alt, 'file.name')
  elem.remove()
}

test('image append w/ query selector', t => {
  renderMedia.append(file, 'body', (err, elem) => {
    verifyImage(t, err, elem)
  })
})

test('image append w/ element', t => {
  renderMedia.append(file, document.body, (err, elem) => {
    verifyImage(t, err, elem)
  })
})

test('image render w/ query selector', t => {
  const img = document.createElement('img')
  document.body.appendChild(img)
  renderMedia.render(file, img, (err, elem) => {
    verifyImage(t, err, elem)
  })
})

test('image render w/ element', t => {
  const img = document.createElement('img')
  document.body.appendChild(img)
  renderMedia.render(file, img, (err, elem) => {
    verifyImage(t, err, elem)
  })
})
