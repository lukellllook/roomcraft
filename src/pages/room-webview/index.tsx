import { Text, View, WebView } from '@tarojs/components'

/* 小程序端没有 WebGL / DOM，3D 房间页改为内嵌已部署的 H5 */
const H5_URL = (process.env.TARO_APP_H5_URL || '').trim()

export default function RoomWebview() {
  if (!H5_URL) {
    return (
      <View
        style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          height: '100vh',
          padding: '0 40px',
          background: '#141317',
          color: '#eae4d8',
          fontSize: '14px',
          lineHeight: '1.8',
          textAlign: 'center'
        }}
      >
        <Text style={{ fontSize: '16px', fontWeight: 'bold', marginBottom: '12px' }}>未配置 H5 地址</Text>
        <Text style={{ color: 'rgba(234, 228, 216, 0.6)' }}>
          在项目根目录 .env 中填写 TARO_APP_H5_URL=https://你的域名/ 后重新编译
        </Text>
      </View>
    )
  }

  return <WebView src={H5_URL} />
}
