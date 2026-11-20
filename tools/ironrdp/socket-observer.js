// Module-local hooks let the fallback client observe its own transport without
// replacing the page's WebSocket constructor (other sessions share the page).
const socketObservers = new Map()
export function observeProxySocket(url, callback) {
  const key = new URL(url).href
  socketObservers.set(key, callback)
  return () => {
    if (socketObservers.get(key) === callback) socketObservers.delete(key)
  }
}
function observeSocket(socket) {
  socketObservers.get(socket.url)?.(socket)
  return socket
}
