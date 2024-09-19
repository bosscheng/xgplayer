/* c8 ignore next 4 */
export { ExpGolomb } from './exp-golomb'
export { Logger } from './logger'
export { UTF8 } from './utf8'
export * from './env'

//  concat Uint8Array
export function concatUint8Array (...arr) {
  arr = arr.filter(Boolean)
  const data = new Uint8Array(arr.reduce((p, c) => p + c.byteLength, 0))
  let prevLen = 0
  arr.forEach((d) => {
    data.set(d, prevLen)
    prevLen += d.byteLength
  })
  return data
}

export const MAX_SIZE = Math.pow(2, 32)

/**
 * 这个函数 readBig16 用于从给定的字节数组 data 中读取一个16位（2字节）的无符号整数，并将其解释为大端字节序（big-endian）。大端字节序意味着高位字节在前，低位字节在后。
 * @param data
 * @param i 索引位置，默认从0 开始
 * @returns {*}
 */
export function readBig16 (data, i = 0) {
  //   // 读取大端字节序的16位整数
  // << 8 将这个值左移8位，相当于乘以256，形成高位字节。
  // 将高位字节的值加上低位字节的值，得到一个16位的无符号整数。
  return (data[i] << 8) + (data[i + 1] || 0)
}

/**
 * 这个函数 readBig24 用于从给定的字节数组 data 中读取一个24位（3字节）的无符号整数，并将其解释为大端字节序（big-endian）。大端字节序意味着高位字节在前，低位字节在后。
 *
 * 它将第一个字节左移16位，第二个字节左移8位，然后加上第三个字节的值，返回一个24位的无符号整数。
 *
 * 这个函数在处理大端字节序的数据时非常有用，尤其是在需要从字节流中读取24位无符号整数的场景。
 * @param data
 * @param i
 * @returns {*}
 */
export function readBig24 (data, i = 0) {
  return (data[i] << 16) + (data[i + 1] << 8) + (data[i + 2] || 0)
}

/**
 * 它将第一个字节左移24位，第二个字节左移16位，第三个字节左移8位，然后加上第四个字节的值，返回一个32位的无符号整数。
 * @param data
 * @param i
 * @returns {*}
 */
export function readBig32 (data, i = 0) {
  return (data[i] << 24 >>> 0) + (data[i + 1] << 16) + (data[i + 2] << 8) + (data[i + 3] || 0)
}

export function readBig64 (data, i = 0) {
  return readBig32(data, i) * MAX_SIZE + readBig32(data, i + 4)
}

/**
 * 生成一个符合 AVC（Advanced Video Coding，或称 H.264）标准的 codec 字符串。具体来说，它将一个字节数组 codecs 转换为符合 avc1. 格式的字符串，并返回。
 * @param codecs
 * @returns {string}
 */
export function getAvcCodec (codecs) {
  let codec = 'avc1.'
  let h
  for (let i = 0; i < 3; i++) {
    h = codecs[i].toString(16)
    if (h.length < 2) h = `0${h}`
    codec += h
  }
  return codec
}

export function formatIV (arr) {
  let iv = ''
  arr.forEach(value => {
    iv += bufferToString(value)
  })
  if (iv.length <= 32) {
    const len = 32 - iv.length
    for (let i = 0; i < len; i++) {
      iv += '0'
    }
  }
  return iv
}

/**
 * @param a
 * @returns {*|*[]}
 */
export function parse (a) {
  if (!Array.isArray(a)) {
    const arr = []
    let value = ''
    for (let i = 0; i < a.length; i++) {
      if (i % 2) {
        value = a[i - 1] + a[i]
        arr.push(parseInt(value, 16))
        value = ''
      }
    }
    return arr
  }
  return a.map(item => { return parseInt(item, 16) })
}
function bufferToString (value) {
  return ('0' + (Number(value).toString(16))).slice(-2).toUpperCase()
}

/**
 *
 * @param str
 * @returns {number}
 */
export function hashVal (str) {
  let hash = 0; let i; let chr
  if (str.length === 0) return hash
  for (i = 0; i < str.length; i++) {
    chr = str.charCodeAt(i)
    hash = ((hash << 5) - hash) + chr
    hash |= 0
  }
  return hash
}

export function combineToFloat (integer, decimal) {
  return Number(integer + '.' + decimal)
}

export function toDegree (matrix) {
  if (matrix.length < 5)
    return 0
  const scaled0 = Math.hypot(matrix[0], matrix[3]), scaled1 = Math.hypot(matrix[1], matrix[4])
  return 0 === scaled0 || 0 === scaled1 ? 0 : 180 * Math.atan2(matrix[1] / scaled1, matrix[0] / scaled0) / Math.PI
}
