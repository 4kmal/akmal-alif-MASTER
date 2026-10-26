import handler from './[file].get'

export default eventHandler(async (event) => {
  await handler(event)
  return null
})
