// 指数哥伦布编码
/**
 * 指数哥伦布码（Exponential-Golomb coding）是一种无损数据压缩方法。
 *
 *
 * 这段代码实现了一个指数哥伦布编码的解码器，通过读取、跳过和解析位流中的数据来实现无损数据压缩的解码功能。
 * 主要功能包括读取特定数量的位、跳过前导零、读取和跳过无符号和有符号的指数哥伦布编码值，以及处理布尔值和无符号字节的读取等。
 */
// 定义一个名为 ExpGolomb 的类
export class ExpGolomb {
  _bytesAvailable  // 剩余可用的字节数
  _bitsAvailable = 0  // 剩余可用的位数，初始化为0
  _word = 0  // 当前处理的32位字

  // 构造函数，接受一个 Uint8Array 类型的参数 data
  constructor (data) {
    if (!data) throw new Error('ExpGolomb data params is required')  // 如果没有传递 data 参数，抛出错误
    this._data = data  // 保存传入的数据
    this._bytesAvailable = data.byteLength  // 初始化剩余可用的字节数
    if (this._bytesAvailable) this._loadWord()  // 如果有可用的字节，加载一个32位字
  }

  // 获取剩余可用的位数
  get bitsAvailable () {
    return this._bitsAvailable
  }

  // 加载一个32位字
  _loadWord () {
    const position = this._data.byteLength - this._bytesAvailable  // 当前读取的位置
    const availableBytes = Math.min(4, this._bytesAvailable)  // 计算可用的字节数，最多4个
    if (availableBytes === 0) throw new Error('No bytes available')  // 如果没有可用的字节，抛出错误

    const workingBytes = new Uint8Array(4)  // 创建一个长度为4的 Uint8Array
    workingBytes.set(this._data.subarray(position, position + availableBytes))  // 将可用的字节复制到 workingBytes

    //
    this._word = new DataView(workingBytes.buffer).getUint32(0)  // 将4个字节转换为一个32位无符号整数

    this._bitsAvailable = availableBytes * 8  // 更新剩余可用的位数

    this._bytesAvailable -= availableBytes  // 更新剩余可用的字节数
  }

  // 跳过指定数量的位
  skipBits (count) {
    if (this._bitsAvailable > count) {
      this._word <<= count  // 左移当前的32位字
      this._bitsAvailable -= count  // 更新剩余可用的位数
    } else {
      count -= this._bitsAvailable  // 更新要跳过的位数
      const skipBytes = Math.floor(count / 8)  // 计算要跳过的字节数
      count -= (skipBytes * 8)  // 更新要跳过的位数
      this._bytesAvailable -= skipBytes  // 更新剩余可用的字节数
      this._loadWord()  // 加载下一个32位字
      this._word <<= count  // 左移当前的32位字
      this._bitsAvailable -= count  // 更新剩余可用的位数
    }
  }

  // 读取指定数量的位，并返回对应的值
  readBits (size) {
    if (size > 32) {
      throw new Error('Cannot read more than 32 bits')  // 如果读取的位数大于32，抛出错误
    }

    let bits = Math.min(this._bitsAvailable, size)  // 计算实际读取的位数
    const val = this._word >>> (32 - bits)  // 提取对应的位

    this._bitsAvailable -= bits  // 更新剩余可用的位数
    if (this._bitsAvailable > 0) {
      this._word <<= bits  // 左移当前的32位字
    } else if (this._bytesAvailable > 0) {
      this._loadWord()  // 加载下一个32位字
    }

    bits = size - bits  // 计算剩余要读取的位数
    if (bits > 0 && this._bitsAvailable) {
      return (val << bits) | this.readBits(bits)  // 递归读取剩余的位
    }
    return val  // 返回读取的值
  }

  // 跳过前导零的数量
  skipLZ () {
    let leadingZeroCount
    for (
      leadingZeroCount = 0;
      leadingZeroCount < this._bitsAvailable;
      ++leadingZeroCount
    ) {
      if ((this._word & (0x80000000 >>> leadingZeroCount)) !== 0) {
        this._word <<= leadingZeroCount  // 左移当前的32位字
        this._bitsAvailable -= leadingZeroCount  // 更新剩余可用的位数
        return leadingZeroCount  // 返回前导零的数量
      }
    }
    this._loadWord()  // 加载下一个32位字
    return leadingZeroCount + this.skipLZ()  // 递归计算前导零的数量
  }

  // 跳过一个无符号指数哥伦布编码的值
  skipUEG () {
    this.skipBits(1 + this.skipLZ())  // 跳过1加上前导零数量的位数
  }

  // 读取一个无符号指数哥伦布编码的值
  readUEG () {
    const clz = this.skipLZ()  // 计算前导零的数量
    return this.readBits(clz + 1) - 1  // 读取对应的值并减1
  }

  // 读取一个有符号指数哥伦布编码的值
  readEG () {
    const val = this.readUEG()  // 读取无符号指数哥伦布编码的值
    if (1 & val) {
      return (1 + val) >>> 1  // 返回正值
    }
    return -1 * (val >>> 1)  // 返回负值
  }

  // 读取一个布尔值
  readBool () {
    return this.readBits(1) === 1  // 读取1位并返回布尔值
  }

  // 读取一个无符号字节
  readUByte () {
    return this.readBits(8)  // 读取8位并返回值
  }

  // 跳过一个缩放列表
  skipScalingList (count) {
    let lastScale = 8
    let nextScale = 8
    let deltaScale
    for (let j = 0; j < count; j++) {
      if (nextScale !== 0) {
        deltaScale = this.readEG()  // 读取缩放差值
        nextScale = (lastScale + deltaScale + 256) % 256  // 计算下一个缩放值
      }
      lastScale = nextScale === 0 ? lastScale : nextScale  // 更新最后的缩放值
    }
  }
}
