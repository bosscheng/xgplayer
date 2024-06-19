import { VideoTrack, AudioTrack, MetadataTrack, AudioSample, VideoSample, VideoCodecType, AudioCodecType, FlvScriptSample, SeiSample } from '../model'
import { FlvFixer } from './fixer'
import { concatUint8Array, Logger, readBig32 } from '../utils'
import { AAC, AVC, HEVC, NALu } from '../codec'
import { AMF } from './amf'

const logger = new Logger('FlvDemuxer')

/**
 * @typedef {Object} DemuxResult
 * @property {VideoTrack} videoTrack
 * @property {AudioTrack} audioTrack
 * @property {MetadataTrack} metadataTrack
 */

export class FlvDemuxer {
  _headerParsed = false
  _remainingData = null
  _gopId = 0
  _needAddMetaBeforeKeyFrameNal = true // 标识H265流中关键帧Nal之前是否需要插入vps、sps、pps Nal

  static AUDIO_RATE = [5500, 11000, 22000, 44000]

  /**
   * @param {VideoTrack} [videoTrack]
   * @param {AudioTrack} [audioTrack]
   * @param {MetadataTrack} [metadataTrack]
   */
  constructor (videoTrack, audioTrack, metadataTrack) {
    this.videoTrack = videoTrack || new VideoTrack()
    this.audioTrack = audioTrack || new AudioTrack()
    this.metadataTrack = metadataTrack || new MetadataTrack()
    this._fixer = new FlvFixer(this.videoTrack, this.audioTrack, this.metadataTrack)
  }

  /**
   * @param {Uint8Array} data
   * @param {boolean} [discontinuity=false] 切流
   * @param {boolean} [contiguous=true]
   * @returns {DemuxResult}
   */
  demux (data, discontinuity = false, contiguous = true) {
    const { audioTrack, videoTrack, metadataTrack } = this

    if (discontinuity || !contiguous) {
      this._remainingData = null
    }

    if (discontinuity) {
      this._headerParsed = false
    }

    if (discontinuity) {
      videoTrack.reset()
      audioTrack.reset()
      metadataTrack.reset()
    } else {
      videoTrack.samples = []
      audioTrack.samples = []
      metadataTrack.seiSamples = []
      metadataTrack.flvScriptSamples = []
      videoTrack.warnings = []
      audioTrack.warnings = []

      if (this._remainingData) {
        data = concatUint8Array(this._remainingData, data)
        this._remainingData = null
      }
    }

    if (!data.length) {
      return {
        videoTrack,
        audioTrack,
        metadataTrack
      }
    }

    // flv header: 9 bytes
    let offset = 0

    // 解析flv header
    if (!this._headerParsed) {
      if (!FlvDemuxer.probe(data)) {
        throw new Error('Invalid flv file')
      }
      audioTrack.present = ((data[4] & 4) >>> 2) !== 0
      videoTrack.present = (data[4] & 1) !== 0
      this._headerParsed = true
      // 9 bytes
      offset = readBig32(data, 5) + 4 // skip prev tag size
    }

    const dataLen = data.length

    let tagType
    let dataSize
    let timestamp
    let bodyData
    let prevTagSize
    // tag header: 11 bytes
    while ((offset + 15) < dataLen) { // header and prev tag size
      // tag header
      tagType = data[offset]
      //
      dataSize = (data[offset + 1] << 16) | (data[offset + 2] << 8) | data[offset + 3]
      // 如果数据不够，跳出循环
      if (offset + 15 + dataSize > dataLen) break

      //
      timestamp = (
        (data[offset + 7] << 24 >>> 0) +
        (data[offset + 4] << 16) +
        (data[offset + 5] << 8) +
        data[offset + 6]
      )

      offset += 11
      bodyData = data.subarray(offset, offset + dataSize)
      if (tagType === 8) {
        this._parseAudio(bodyData, timestamp)
      } else if (tagType === 9) {
        this._parseVideo(bodyData, timestamp)
      } else if (tagType === 18) {
        this._parseScript(bodyData, timestamp)
      } else {
        logger.warn(`Invalid tag type: ${tagType}`)
      }

      offset += dataSize
      prevTagSize = readBig32(data, offset)
      if (prevTagSize !== 11 + dataSize) {
        logger.warn(`Invalid PrevTagSize ${prevTagSize} (${11 + dataSize})`)
      }

      offset += 4
    }

    if (offset < dataLen) {
      this._remainingData = data.subarray(offset)
    }

    audioTrack.formatTimescale = videoTrack.formatTimescale = videoTrack.timescale = metadataTrack.timescale = 1000
    audioTrack.timescale = audioTrack.sampleRate || 0

    if (!audioTrack.exist() && audioTrack.hasSample()) {
      audioTrack.reset()
    }
    if (!videoTrack.exist() && videoTrack.hasSample()) {
      videoTrack.reset()
    }

    return {
      videoTrack,
      audioTrack,
      metadataTrack
    }
  }

  /**
   * @param {number} [startTime=0]
   * @param {boolean} [discontinuity=false]
   * @param {boolean} [contiguous=true]
   * @returns {DemuxResult}
   */
  fix (startTime, discontinuity, contiguous) {
    this._fixer.fix(startTime, discontinuity, contiguous)
    return {
      videoTrack: this.videoTrack,
      audioTrack: this.audioTrack,
      metadataTrack: this.metadataTrack
    }
  }

  /**
   * @param {Uint8Array} data
   * @param {boolean} [discontinuity=false]
   * @param {boolean} [contiguous=true]
   * @param {number} [startTime=0]
   * @returns {DemuxResult}
   */
  demuxAndFix (data, discontinuity, contiguous, startTime) {
    this.demux(data, discontinuity, contiguous)
    return this.fix(startTime, discontinuity, contiguous)
  }

  /**
   * 判断是否是flv文件
   * @param { Uint8Array } data
   * @returns {boolean}
   */
  static probe (data) {
    if (data[0] !== 0x46 || data[1] !== 0x4C || data[2] !== 0x56 || data[3] !== 0x01) {
      return false
    }
    return readBig32(data, 5) >= 9
  }

  _parseAudio (data, pts) {
    if (!data.length) return

    const format = (data[0] & 0xf0) >>> 4
    const track = this.audioTrack

    if (
      format !== 10 && // AAC
      format !== 7 && // G.711 A-law logarithmic PCM
      format !== 8 // G.711 mu-law logarithmic PCM
    ) {
      logger.warn(`Unsupported sound format: ${format}`)
      track.reset()
      return
    }

    if (format !== 10) {
      const soundRate = (data[0] & 0x0c) >> 2
      const soundSize = (data[0] & 0x02) >> 1
      const soundType = (data[0] & 0x01)
      track.sampleRate = FlvDemuxer.AUDIO_RATE[soundRate]
      track.sampleSize = soundSize ? 16 : 8
      track.channelCount = soundType + 1
    }

    if (format === 10) {
      this._parseAac(data, pts)
    } else {
      this._parseG711(data, pts, format)
    }
  }

  _parseG711 (data, pts, format) {
    const track = this.audioTrack
    track.codecType = format === 7 ? AudioCodecType.G711PCMA : AudioCodecType.G711PCMU
    track.sampleRate = 8000
    track.codec = track.codecType
    track.samples.push(new AudioSample(pts, data.subarray(1)))
  }

  _parseAac (data, pts) {
    const track = this.audioTrack
    track.codecType = AudioCodecType.AAC

    if (data[1] === 0) { // AACPacketType
      const ret = AAC.parseAudioSpecificConfig(data.subarray(2))
      if (ret) {
        track.codec = ret.codec
        track.channelCount = ret.channelCount
        track.sampleRate = ret.sampleRate
        track.config = ret.config
        track.objectType = ret.objectType
        track.sampleRateIndex = ret.samplingFrequencyIndex
      } else {
        track.reset()
        logger.warn('Cannot parse AudioSpecificConfig', data)
      }
    } else if (data[1] === 1) { // Raw AAC frame data
      if (pts === undefined || pts === null) return
      track.samples.push(new AudioSample(pts, data.subarray(2)))
    } else {
      logger.warn(`Unknown AACPacketType: ${data[1]}`)
    }
  }

  _parseVideo (data, dts) {
    if (data.length < 6) return

    const frameType = (data[0] & 0xf0) >>> 4
    const codecId = data[0] & 0x0f

    const track = this.videoTrack

    if (
      codecId !== 7 && // AVC
      codecId !== 12 // HEVC
    ) {
      track.reset()
      logger.warn(`Unsupported codecId: ${codecId}`)
      return
    }

    const isHevc = codecId === 12
    track.codecType = isHevc ? VideoCodecType.HEVC : VideoCodecType.AVC

    const packetType = data[1]
    const cts = (((data[2] << 16) | (data[3] << 8) | (data[4])) << 8) >> 8

    if (packetType === 0) { // DecoderConfigurationRecord
      const configData = data.subarray(5)
      const ret = isHevc
        ? HEVC.parseHEVCDecoderConfigurationRecord(configData)
        : AVC.parseAVCDecoderConfigurationRecord(configData)
      if (ret) {
        const { hvcC, sps, ppsArr, spsArr, vpsArr, nalUnitSize } = ret
        if (hvcC) {
          track.hvcC = track.hvcC || hvcC
        }
        if (sps) {
          track.codec = sps.codec
          track.width = sps.width
          track.height = sps.height
          track.sarRatio = sps.sarRatio
          track.fpsNum = sps.fpsNum
          track.fpsDen = sps.fpsDen
        }
        if (spsArr.length) track.sps = spsArr
        if (ppsArr.length) track.pps = ppsArr
        if (vpsArr && vpsArr.length) track.vps = vpsArr
        if (nalUnitSize) track.nalUnitSize = nalUnitSize
      } else {
        logger.warn(`Cannot parse ${isHevc ? 'HEVC' : 'AVC'}DecoderConfigurationRecord`, data)
      }
    } else if (packetType === 1) { // One or more NALUs
      let units = NALu.parseAvcC(data.subarray(5), track.nalUnitSize)

      units = this._checkAddMetaNalToUnits(isHevc, units, track)

      if (units && units.length) {
        const sample = new VideoSample(dts + cts, dts, units)
        if (frameType === 1) {
          sample.setToKeyframe()
        }
        track.samples.push(sample)

        units.forEach(unit => {
          const type = isHevc ? (unit[0] >>> 1) & 0x3f : unit[0] & 0x1f
          switch (type) {
            case 5: // IDR
            case 16: // HEVC BLA_W_LP
            case 17: // HEVC BLA_W_RADL
            case 18: // HEVC BLA_N_LP
            case 19: // HEVC IDR_W_RADL
            case 20: // HEVC IDR_N_LP
            case 21: // HEVC CRA_NUT
            case 22: // HEVC RSV_IRAP_VCL22
            case 23: // HEVC RSV_IRAP_VCL23
              if ((!isHevc && type !== 5) || (isHevc && type === 5)) break
              sample.setToKeyframe()
              break
            case 6: // SEI
            case 39: // HEVC PREFIX_SEI
            case 40: // HEVC SUFFIX_SEI
              if ((!isHevc && type !== 6) || (isHevc && type === 6)) break
              this.metadataTrack.seiSamples.push(new SeiSample(
                NALu.parseSEI(NALu.removeEPB(unit), isHevc),
                dts + cts
              ))
              break
            default:
          }
        })

        if (sample.keyframe) {
          this._gopId++
        }
        sample.gopId = this._gopId
      } else {
        logger.warn('Cannot parse NALUs', data)
      }
    } else if (packetType === 2) {
      // AVC end of sequence, Empty
    } else {
      logger.warn(`Unknown AVCPacketType: ${packetType}`)
    }
  }

  _checkAddMetaNalToUnits (hevc, units, track) {
    if (!hevc || !this._needAddMetaBeforeKeyFrameNal) {
      this._needAddMetaBeforeKeyFrameNal = false
      return units
    }

    const nalTypes = units.map(x => (x[0] >>> 1) & 0x3f)

    if (nalTypes.includes(32)) {
      this._needAddMetaBeforeKeyFrameNal = false
      return units
    }

    units.unshift(track.pps[0])
    units.unshift(track.sps[0])
    units.unshift(track.vps[0])

    return units.filter(Boolean)
  }

  _parseScript (data, pts) {
    this.metadataTrack.flvScriptSamples.push(new FlvScriptSample(AMF.parse(data), pts))
  }
}
