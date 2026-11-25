/* 小程序端没有 WebGL / DOM，入口换成 web-view 内嵌已部署的 H5；H5 端仍是 3D 场景页 */
const isWeapp = process.env.TARO_ENV === 'weapp'

export default defineAppConfig({
  pages: isWeapp ? ['pages/room-webview/index'] : ['pages/scene/index'],
  window: {
    backgroundTextStyle: 'dark',
    navigationBarBackgroundColor: '#1b1a1f',
    navigationBarTitleText: 'RoomCraft · 房间工坊',
    navigationBarTextStyle: 'white',
    backgroundColor: '#141317'
  }
})
