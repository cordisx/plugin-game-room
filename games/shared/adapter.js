// Renderers consume seat observations, never private state or credentials.
globalThis.gameAdapter = (() => {
  let listener = null
  let dispatch = null
  return {
    subscribe(callback) {
      listener = callback
    },
    receive(observation) {
      listener?.(observation)
    },
    connect(send) {
      dispatch = send
    },
    send(action) {
      if (!dispatch) throw Error('游戏连接尚未就绪')
      return dispatch(action)
    },
  }
})()
