'use strict'

const log4js = require('log4js')
const Padchat = require('./index')
const fs = require('fs')

const args = process.argv.splice(2)

const key = args[0]// 授权key
const name = args[1]// 子账号名，用于区分多个账号，任意设置即可

const WxServer = 'http://52.80.36.166/user'
// WxServer = 'http://127.0.0.1:7001/user' // 本地调试地址，请忽略

/**
* 创建日志目录
*/

try {
  require('fs').mkdirSync('./logs')
} catch (e) {
  if (e.code !== 'EEXIST') {
    console.error('Could not set up log directory, error: ', e)
    process.exit(1)
  }
}

try {
  log4js.configure('./log4js.json')
} catch (e) {
  console.error('载入log4js日志输出配置错误: ', e)
  process.exit(1);
}

const logger = log4js.getLogger('app')

logger.info('demo start!')

var deviceInfo = {
  deviceName: '',
  deviceUuid: '',
  deviceWifiName: '',
  deviceWifiMac: '',
  deviceData: '',
}

const autoData = {
  token: '',
}

try {
  const tmpBuf = fs.readFileSync('./config.json')
  const data = JSON.parse(String(tmpBuf))
  deviceInfo.deviceName = data.deviceName
  deviceInfo.deviceUuid = data.deviceUuid
  deviceInfo.deviceWifiName = data.deviceWifiName
  deviceInfo.deviceWifiMac = data.deviceWifiMac
  deviceInfo.deviceData = data.deviceData
  autoData.token = data.token
  logger.info('载入设备参数: %o \n\n自动登陆数据：%o ', deviceInfo, autoData)
} catch (e) {
  logger.warn('没有在本地发现设备登录参数或解析数据失败！如首次登录请忽略！现已用随机生成')
  deviceInfo = Padchat.getRandomDevice()
}

const wx = new Padchat(key, name, {
  url: WxServer,
})
logger.info('当前连接接口服务器为：', WxServer)

wx
  .on('disconnect', () => {
    logger.info('与服务器连接断开！')
  })
  .on('reconnect', () => {
    logger.info('与服务器重连成功！')
  })
  .on('connect_error', e => {
    logger.error('与服务器连接错误：', e.message)
  })
  .on('connect', async () => {
    let ret
    logger.info('连接成功!')

    // 非首次登录时最好使用以前成功登录时使用的设备参数，
    // 否则可能会被tx服务器怀疑账号被盗，导致手机端被登出
    ret = await wx.init(deviceInfo)
    if (!ret.success) {
      logger.error('新建任务失败！', ret)
      return
    }
    logger.info('新建任务成功, json: ', ret)

    if (autoData.token) {
      ret = await wx.login('token', autoData)
      if (ret.success) {
        logger.info('自动登录成功！', ret)
        return
      }
      logger.warn('自动登录失败！', ret)
    }

    ret = await wx.login('qrcode')
    if (!ret.success) {
      logger.error('使用qrcode登录模式失败！', ret)
      return
    }
    logger.info('使用qrcode登录模式！')
  })
  .on('qrcode', data => {
    if (!data.qrCode) {
      logger.error('没有在数据中获得登陆二维码！', data)
      return
    }
    fs.writeFileSync('./qrcode.jpg', Buffer.from(data.qrCode || '', 'base64'))
    logger.info('登陆二维码已经写入到 ./qrcode.jpg，请打开扫码登陆！')
  })
  .on('scan', data => {
    switch (data.status) {
      case 0:
        logger.info('等待扫码...', data)
        break;
      case 1:
        logger.info('已扫码，请在手机端确认登陆...', data)
        break;
      case 2:
        switch (data.subStatus) {
          case 0:
            logger.info('扫码成功！登陆成功！', data)
            break;
          case 1:
            logger.info('扫码成功！登陆失败！', data)
            break;
          default:
            logger.info('扫码成功！未知状态码！', data)
            break;
        }
        break;
      case 3:
        logger.info('二维码已过期！', data)
        break;
      case 4:
        logger.info('手机端已取消登陆！', data)
        break;
      default:
        break;
    }
  })
  .on('login', async () => {
    logger.info('微信账号登陆成功！')
    let ret
    ret = await wx.getDeviceInfo()
    if (!ret.success) {
      logger.warn('获取设备参数未成功！ json:', ret)
      return
    }
    logger.info('获取设备参数成功, json: ', ret)

    const tmp = Object.assign({}, ret.data)

    ret = await wx.getAutoLoginData()
    if (!ret.success) {
      logger.warn('获取自动登陆数据未成功！ json:', ret)
      return
    }
    logger.info('获取自动登陆数据成功, json: ', ret)
    Object.assign(tmp, { token: ret.data.token })

    // NOTE: 这里将设备参数保存到本地，以后再次登录此账号时提供相同参数
    fs.writeFileSync('./config.json', JSON.stringify(tmp))
    logger.info('设备参数已写入到 ./config.json文件')
  })
  .on('logout', ({ msg }) => {
    logger.info('微信账号已退出！', msg)
  })
  .on('close', ({ msg }) => {
    logger.info('任务已关闭！', msg)
  })
  .on('loaded', async () => {
    logger.info('通讯录同步完毕！')

    const ret = await wx.sendMsg('filehelper', '你登录了！')
    logger.info('发送信息结果：', ret)
  })
  .on('sns', (data, msg) => {
    logger.info('收到朋友圈事件！请查看朋友圈新消息哦！', msg)
  })
  .on('push', async data => {
    // 消息类型 data.msgType
    // 1  文字消息
    // 2  好友信息推送，包含好友，群，公众号信息
    // 3  收到图片消息
    // 34  语音消息
    // 35  用户头像buf
    // 37  收到好友请求消息
    // 42  名片消息
    // 43  视频消息
    // 47  表情消息
    // 48  定位消息
    // 49  APP消息(文件 或者 链接 H5)
    // 50  语音通话
    // 51  状态通知（如打开与好友/群的聊天界面）
    // 52  语音通话通知
    // 53  语音通话邀请
    // 62  小视频
    // 2000  转账消息
    // 2001  收到红包消息
    // 3000  群邀请
    // 9999  系统通知
    // 10000  微信通知信息. 微信群信息变更通知，多为群名修改，进群，离群信息，不包含群内聊天信息
    // 10002  撤回消息
    // --------------------------------
    // 注意，如果是来自微信群的消息，data.content字段中包含发言人的wxid及其发言内容，需要自行提取
    // 各类复杂消息，data.content中是xml格式的文本内容，需要自行从中提取各类数据。（如好友请求）
    let ret

    switch (data.msgType) {
      case 2:
        logger.info('收到推送联系人：', data.nickName)
        break

      case 1:
        if (data.fromUser === 'newsapp') { // 腾讯新闻发的信息太长
          break
        }
        logger.info('收到来自 %s 的文本消息：', data.fromUser, data.description || data.content)
        if (/ding/.test(data.content)) {
          await wx.sendMsg(data.fromUser, 'dong')
            .then(ret => {
              logger.info('回复信息给%s 结果：', data.fromUser, ret)
            })
            .catch(e => {
              logger.warn('回复信息异常:', e.message)
            })
        }
        break

      default:
        logger.info('收到推送消息：', data)
        break
    }
  })
  .on('error', e => {
    logger.error('socket.io 错误:', e)
  })
  .on('warn', ({ error }) => {
    logger.error('任务出现错误:', error)
  })


process.on('uncaughtException', e => {
  logger.error('Main', 'uncaughtException:', e)
})

process.on('unhandledRejection', e => {
  logger.error('Main', 'unhandledRejection:', e)
})
